/**
 * Discovery: harvest candidate Slugs, probe them, and report what is worth
 * promoting into the curated set.
 *
 *   pnpm discover -- --limit 300
 *
 * Run by hand, and by hand only. Harvesting every Slug on every sweep is what
 * the curated set exists to avoid — see `docs/research/job-sources.md` for the
 * measured yield, and ADR 0003 for why Slugs have to be harvested at all — so
 * this is not an application feature and nothing schedules it. It writes
 * nothing: the output is a list for a human to read, and promoting a Board
 * means editing the seed file.
 *
 * Needs DATABASE_URL, only so that Boards already curated are not re-probed.
 */
import { listBoards, type BoardAddress, type BoardProbe } from "@/operations";
import { closeDb } from "@/db";
import { harvestGreenhouseSlugs } from "./discovery/greenhouse-slugs";
import { probeCandidates } from "./discovery/probe-many";
import { describe, everyFew, summarise } from "./discovery/report";
import { sample } from "./discovery/sample";

/**
 * How many candidates to probe unless told otherwise.
 *
 * A probe asks for a Board's full descriptions, so this bounds real bandwidth
 * against a public API. Raise it deliberately, not by default.
 */
const DEFAULT_LIMIT = 200;

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
  const limit = numeric("limit") ?? DEFAULT_LIMIT;
  const pages = numeric("pages");
  const index = text("index");

  console.log("Harvesting candidate Slugs from Common Crawl…");
  const { slugs: harvested, skippedPages } = await harvestGreenhouseSlugs({
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
      .filter((board) => board.source === "greenhouse")
      .map((board) => board.slug),
  );

  // Sampled rather than sliced: the harvest arrives sorted, so taking the
  // first few hundred would probe the front of the alphabet and nothing else.
  const candidates: BoardAddress[] = sample(
    harvested.filter((slug) => !curated.has(slug)),
    limit,
  ).map((slug) => ({ source: "greenhouse", slug }));

  console.log(
    `  ${curated.size} already curated; probing ${candidates.length} of the rest\n`,
  );

  const ranked = await probeCandidates(candidates, { onProbed: everyFew() });
  report(ranked);
}

/** The ranked candidates, as a human reads them. */
function report(ranked: readonly BoardProbe[]): void {
  const { live, postings } = summarise(ranked);

  console.log(
    `\n${live.length}/${ranked.length} live, ${postings} Postings between them\n`,
  );
  for (const probe of ranked) console.log(describe(probe));

  const worthPromoting = live.filter((probe) => probe.postings > 0);
  console.log(
    "\nPaste into scripts/data/greenhouse-boards.ts what you want swept:\n",
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
