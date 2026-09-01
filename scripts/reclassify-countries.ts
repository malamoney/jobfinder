/**
 * Re-derives every Posting's country from its location text, then clears the
 * non-US roles no User has acted on — the whole Corpus in one pass, no batch cap.
 *
 *   pnpm reclassify-countries            # re-classify, then prune
 *   pnpm reclassify-countries --dry-run  # report what would move and be pruned
 *
 * The nightly sweep already does this (`reclassifyCountries` then
 * `pruneNonUsPostings` in `drainAndRematch`), but bounded — a large backlog
 * clears over a night or two. Run this by hand after a fix to `extractCountry`'s
 * heuristic (#67: `Berlin, DE` had been read as Delaware) to resolve it in one
 * go rather than waiting.
 *
 * A role a User has a Status or Note on is kept whatever its location says
 * (ADR 0004) — it just drops off the default Dashboard view.
 *
 * Needs DATABASE_URL. Re-run matching afterwards (the nightly sweep does, or the
 * Dashboard's "Run matching now") so the removed roles leave every Match set.
 */
import { and, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { postings, reviewState } from "@/db/schema";
import { extractCountry } from "@/postings/country";
import { pruneNonUsPostings, reclassifyCountries } from "@/operations/prune";

async function main(): Promise<void> {
  const db = getDb();
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({ location: postings.location, country: postings.country })
    .from(postings);

  let wouldMove = 0;
  for (const row of rows) {
    if (extractCountry(row.location) !== row.country) wouldMove++;
  }
  console.log(`${rows.length} roles in the Corpus; ${wouldMove} would change country.`);

  if (dryRun) {
    const [{ prunable }] = await db
      .select({ prunable: sql<number>`count(*)::int` })
      .from(postings)
      .where(
        and(
          or(isNull(postings.country), ne(postings.country, "us")),
          notExists(
            db
              .select({ one: sql`1` })
              .from(reviewState)
              .where(eq(reviewState.postingId, postings.id)),
          ),
        ),
      );
    console.log(
      `--dry-run: ${prunable} currently-non-US role(s) with no Review State would be deleted ` +
        `(counted before re-classification — the real figure is higher).`,
    );
    return;
  }

  const moved = await reclassifyCountries();
  console.log(`Re-classified ${moved} role(s).`);

  let deleted = 0;
  for (;;) {
    const batch = await pruneNonUsPostings();
    deleted += batch;
    if (batch === 0) break;
    console.log(`  pruned ${deleted}…`);
  }
  console.log(`Deleted ${deleted} non-US role(s) no User had acted on.`);
  console.log("Re-run matching so they leave every Match set.");
}

try {
  await main();
} finally {
  await closeDb();
}
