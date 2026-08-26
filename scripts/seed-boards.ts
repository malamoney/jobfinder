/**
 * Seeds the curated set: the Boards a nightly sweep actually covers.
 *
 *   pnpm seed:boards
 *
 * Every Slug is probed before it is written, so seeding proves the set is
 * fetchable rather than asserting it. A Slug that cannot be read is still
 * added — disabled. Deleting it, or leaving it out, would only let the next
 * discovery run rediscover it and offer it up again as though it were new;
 * disabled, it is a decision that stays made and can be revisited when the
 * set is revalidated.
 *
 * Safe to re-run, which is the normal case: the seed file grows as discovery
 * turns up Boards worth promoting, and every Board keeps the id its Postings
 * already reference.
 */
import { addBoard, type BoardAddress } from "@/operations";
import { closeDb } from "@/db";
import { probeCandidates } from "./discovery/probe-many";
import { GREENHOUSE_BOARDS } from "./data/greenhouse-boards";

async function main(): Promise<void> {
  const candidates: BoardAddress[] = GREENHOUSE_BOARDS.map((slug) => ({
    source: "greenhouse",
    slug,
  }));

  console.log(`Probing ${candidates.length} Boards before seeding…`);
  const probed = await probeCandidates(candidates, {
    onProbed: (_probe, done, total) => {
      if (done % 25 === 0 || done === total) {
        console.log(`  probed ${done}/${total}`);
      }
    },
  });

  for (const probe of probed) {
    await addBoard({
      source: probe.source,
      slug: probe.slug,
      enabled: probe.error === null,
    });
  }

  const live = probed.filter((probe) => probe.error === null);
  const roles = live.reduce((total, probe) => total + probe.postings, 0);

  console.log(
    `\nSeeded ${probed.length} Boards: ${live.length} enabled, ` +
      `${probed.length - live.length} disabled as unreachable.`,
  );
  console.log(`${roles} open roles are waiting for the first sweep.`);

  for (const probe of probed.filter((entry) => entry.error !== null)) {
    console.log(`  disabled  ${probe.slug}  ${probe.error?.slice(0, 80)}`);
  }
}

try {
  await main();
} finally {
  await closeDb();
}
