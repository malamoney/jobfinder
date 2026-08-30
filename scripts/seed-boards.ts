/**
 * Seeds the curated set: the Boards a nightly sweep actually covers.
 *
 *   pnpm seed:boards
 *
 * Every Slug is probed before it is written, so seeding proves the set is
 * fetchable rather than asserting it. A Slug that cannot be read is still
 * added — disabled. Leaving it out would only let the next discovery run
 * rediscover it and offer it up again as though it were new; disabled, it is a
 * decision that stays made and can be revisited when the set is revalidated.
 *
 * Safe to re-run, which is the normal case: the seed file grows as discovery
 * turns up Boards worth promoting. A Board already in the set keeps both the
 * id its Postings reference and whether it is currently swept — seeding says
 * which Boards exist, not which are enabled, so a Board someone turned off
 * stays off.
 */
import { seedBoards, type BoardAddress } from "@/operations";
import { closeDb } from "@/db";
import { probeCandidates } from "./discovery/probe-many";
import { describe, everyFew, summarise } from "./discovery/report";
import { AGGREGATOR_BOARDS } from "./data/aggregator-boards";
import { GREENHOUSE_BOARDS } from "./data/greenhouse-boards";
import { WORKDAY_BOARDS } from "./data/workday-boards";

async function main(): Promise<void> {
  const candidates: BoardAddress[] = [
    ...GREENHOUSE_BOARDS.map((slug) => ({
      source: "greenhouse" as const,
      slug,
    })),
    ...AGGREGATOR_BOARDS,
    ...WORKDAY_BOARDS,
  ];

  console.log(`Probing ${candidates.length} Boards before seeding…`);
  const probed = await probeCandidates(candidates, { onProbed: everyFew() });

  await seedBoards(
    probed.map((probe) => ({
      source: probe.source,
      slug: probe.slug,
      enabled: probe.error === null,
    })),
  );

  const { live, dead, postings } = summarise(probed);
  console.log(
    `\nSeeded ${probed.length} Boards: ${live.length} answered, ` +
      `${dead.length} could not be read.`,
  );
  console.log(`${postings} Postings are waiting for the first sweep.`);

  if (dead.length > 0) {
    console.log("\nAdded disabled, or left as they were:\n");
    for (const probe of dead) console.log(describe(probe));
  }
}

try {
  await main();
} finally {
  await closeDb();
}
