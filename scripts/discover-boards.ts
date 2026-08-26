/**
 * Discovery: harvest candidate Slugs, probe them, and report what is worth
 * promoting into the curated set.
 *
 *   pnpm discover -- --limit 300
 *
 * Run by hand, and by hand only. ADR 0003 chose curation over harvesting on
 * cost — the full harvest is around ninety-five thousand Slugs, twenty
 * gigabytes a day, and a multi-hour sweep — so this is not an application
 * feature and nothing schedules it. It writes nothing: the output is a list
 * for a human to read, and promoting a Board means editing the seed file.
 *
 * Needs DATABASE_URL, only so that Boards already curated are not re-probed.
 */
import { listBoards, type BoardAddress } from "@/operations";
import { closeDb } from "@/db";
import { harvestGreenhouseSlugs } from "./discovery/greenhouse-slugs";
import { probeCandidates } from "./discovery/probe-many";
import { sample } from "./discovery/sample";

/**
 * How many candidates to probe unless told otherwise.
 *
 * A probe asks for a Board's full descriptions, so this bounds real bandwidth
 * against a public API. Raise it deliberately, not by default.
 */
const DEFAULT_LIMIT = 200;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const limit = Number(argument("limit") ?? DEFAULT_LIMIT);
  const index = argument("index");
  const records = argument("records") ? Number(argument("records")) : undefined;

  console.log("Harvesting candidate Slugs from Common Crawl…");
  const harvested = await harvestGreenhouseSlugs({ index, records });
  console.log(`  ${harvested.length} distinct Slugs`);

  const curated = new Set(
    (await listBoards())
      .filter((board) => board.source === "greenhouse")
      .map((board) => board.slug),
  );
  // Sampled rather than sliced: a harvest arrives sorted, so taking the first
  // few hundred would probe the alphabetical head, which on Common Crawl is
  // numerals and test Boards rather than companies.
  const candidates: BoardAddress[] = sample(
    harvested.filter((slug) => !curated.has(slug)),
    limit,
  ).map((slug) => ({ source: "greenhouse", slug }));

  console.log(
    `  ${curated.size} already curated; probing ${candidates.length} of the rest\n`,
  );

  const ranked = await probeCandidates(candidates, {
    onProbed: (probe, done, total) => {
      if (done % 25 === 0 || done === total) {
        console.log(`  probed ${done}/${total}`);
      }
    },
  });

  report(ranked);

  const worthPromoting = ranked.filter(
    (probe) => probe.error === null && probe.postings > 0,
  );
  console.log(
    "\nPaste into scripts/data/greenhouse-boards.ts what you want swept:\n",
  );
  console.log(
    worthPromoting.map((probe) => `  "${probe.slug}",`).join("\n") || "  (none)",
  );
}

/** The ranked candidates, as a human reads them. */
function report(ranked: Awaited<ReturnType<typeof probeCandidates>>): void {
  const live = ranked.filter((probe) => probe.error === null);
  const roles = live.reduce((total, probe) => total + probe.postings, 0);

  console.log(
    `\n${live.length}/${ranked.length} live, ${roles} open roles between them\n`,
  );
  for (const probe of ranked) {
    const count = probe.error ? "dead" : String(probe.postings).padStart(4);
    const why = probe.error ? `  ${probe.error.slice(0, 80)}` : "";
    console.log(`  ${count}  ${probe.slug}${why}`);
  }
}

try {
  await main();
} finally {
  await closeDb();
}
