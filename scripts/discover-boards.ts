/**
 * Discovery: harvest candidate Slugs, probe them, and report what is worth
 * promoting into the curated set.
 *
 *   pnpm discover -- --source recruitee
 *   pnpm discover -- --limit 300           # a quick look at a random subset
 *
 * `--source` is one of the ATS Sources with a harvester (`greenhouse` — the
 * default — `lever`, `ashby`, `workable`, `recruitee`); everything else about
 * the run is the same whichever it is.
 *
 * By default every harvested Slug not already curated is probed, so the ranked
 * report is the whole harvest and a company cannot be missed just for not
 * being sampled. `--limit N` probes a random N instead, for a fast pass.
 *
 * Run by hand, and by hand only. Probing thousands of Boards is fine here —
 * it is one 8-wide walk over a public API, minutes long, run when someone
 * chooses to — and nothing like what the curated set exists to keep off the
 * nightly sweep (ADR 0003, `docs/research/job-sources.md`). This is not an
 * application feature and nothing schedules it. It writes nothing: the output
 * is a list for a human to read, and promoting a Board means editing the seed
 * file.
 *
 * Needs DATABASE_URL, only so that Boards already curated are not re-probed.
 */
import { listBoards, type BoardAddress, type BoardProbe } from "@/operations";
import { closeDb } from "@/db";
import { harvestSlugs } from "./discovery/common-crawl";
import { probeCandidates } from "./discovery/probe-many";
import { describe, everyFew, summarise } from "./discovery/report";
import { sample } from "./discovery/sample";
import { DEFAULT_SOURCE, discoverySourceFor } from "./discovery/sources";

/**
 * Reads a numeric flag, and refuses a value that is not one.
 *
 * `--limit` with nothing after it used to read as `NaN`, which sampled nothing
 * and probed nothing, and said so only by finishing suspiciously fast.
 */
function numeric(name: string): number | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;

  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} needs a positive number after it`);
  }
  return value;
}

function text(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const limit = numeric("limit");
  const pages = numeric("pages");
  const index = text("index");
  const source = discoverySourceFor(text("source") ?? DEFAULT_SOURCE);

  console.log(`Harvesting candidate ${source.source} Slugs from Common Crawl…`);
  const { slugs: harvested, skippedPages } = await harvestSlugs(source, {
    index,
    pages,
  });
  console.log(`  ${harvested.length} distinct Slugs`);

  if (skippedPages > 0) {
    // Said plainly, because the run will otherwise look like a clean one. A
    // page is a stretch of the alphabet, so what is missing is every Board
    // whose Slug starts with certain letters — not a thinner sample of them.
    console.warn(
      `  ! ${skippedPages} page(s) unread: this harvest is missing whole\n` +
        "    ranges of the alphabet, so treat the sample as incomplete and\n" +
        "    run it again before promoting anything from it.",
    );
  }

  const curated = new Set(
    (await listBoards())
      .filter((board) => board.source === source.source)
      .map((board) => board.slug),
  );

  const uncurated = harvested.filter((slug) => !curated.has(slug));

  // Shuffled, not sliced, even when probing all of them: the harvest arrives
  // sorted, so a run cut short partway would otherwise have covered the front
  // of the alphabet and nothing else. `--limit` takes a random N of the same
  // shuffle.
  const candidates: BoardAddress[] = sample(
    uncurated,
    limit ?? uncurated.length,
  ).map((slug) => ({ source: source.source, slug }));

  console.log(
    `  ${curated.size} already curated; probing ${candidates.length}` +
      `${limit === undefined ? "" : ` of ${uncurated.length}`} of the rest\n`,
  );

  const ranked = await probeCandidates(candidates, {
    onProbed: everyFew(candidates.length > 500 ? 100 : 25),
  });
  report(ranked, source.source);
}

/** The ranked candidates, as a human reads them. */
function report(ranked: readonly BoardProbe[], source: string): void {
  const { live, postings } = summarise(ranked);

  console.log(
    `\n${live.length}/${ranked.length} live, ${postings} Postings between them\n`,
  );
  for (const probe of ranked) console.log(describe(probe));

  const worthPromoting = live.filter((probe) => probe.postings > 0);
  console.log(
    `\nPaste into scripts/data/${source}-boards.ts what you want swept:\n`,
  );
  console.log(
    worthPromoting.map((probe) => `  "${probe.slug}",`).join("\n") || "  (none)",
  );
}

try {
  await main();
} finally {
  await closeDb();
}
