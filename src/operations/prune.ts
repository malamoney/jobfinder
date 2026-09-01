import { and, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, reviewState } from "@/db/schema";
import { extractCountry, type Country } from "@/postings/country";

/**
 * Removing the roles the Corpus should never have held: those the location text
 * does not place in the United States (ADR 0010, superseding ADR 0009).
 *
 * Ingestion keeps new foreign roles out (`reconcileBoard`); this clears the ones
 * stored before that gate existed. It runs at the end of the nightly sweep, once
 * the queue is drained (`drainAndRematch`), bounded so a first pass over a large
 * backlog cannot overrun the drain budget — whatever it does not reach is caught
 * by the next run.
 */

/**
 * The most roles one prune removes. A first run over a Corpus that has never
 * been pruned could otherwise delete tens of thousands of rows in one statement
 * and blow the 50-second drain budget (`DEFAULT_DRAIN_BUDGET_MS`). The rest wait
 * for tomorrow.
 */
export const PRUNE_BATCH_SIZE = 500;

/**
 * Deletes up to `batchSize` non-US roles that no User has Review State on, and
 * returns how many it removed.
 *
 * Three things have to be true of a role for it to go:
 *
 * - Its stored country is not `us` — foreign, placeless, or classified before
 *   ADR 0009 and still null. A null country is classified here from the same
 *   location text `extractCountry` reads everywhere else.
 * - No User has a Review State row for it. That row exists only once someone
 *   moved its Status off `new` or wrote a Note, so its presence *is* "a User
 *   acted on this role", and ADR 0004 keeps such a role forever — a Posting
 *   someone marked `applied` must never vanish from their tracker.
 * - It survives the batch limit; the remainder is next run's problem.
 *
 * A Dedup Key group needs no special handling: a `us` member is never a
 * candidate, and a foreign member a User reviewed is kept by the Review State
 * check, so a group never loses the member that carries its state (ADR 0006).
 * `matches` rows cascade with the Posting and are rebuilt on the next match run.
 */
export async function pruneNonUsPostings(
  batchSize = PRUNE_BATCH_SIZE,
): Promise<number> {
  const db = getDb();

  const candidates = await db
    .select({
      id: postings.id,
      country: postings.country,
      location: postings.location,
    })
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
    )
    .orderBy(postings.lastSeenAt)
    .limit(batchSize);

  if (candidates.length === 0) return 0;

  const nonUs: string[] = [];
  const nowUs: string[] = [];
  for (const row of candidates) {
    const country = row.country ?? extractCountry(row.location);
    (country === "us" ? nowUs : nonUs).push(row.id);
  }

  // A legacy row that actually classifies US: record the classification so the
  // next prune does not scan it again.
  if (nowUs.length > 0) {
    await db
      .update(postings)
      .set({ country: "us" })
      .where(inArray(postings.id, nowUs));
  }

  if (nonUs.length === 0) return 0;
  await db.delete(postings).where(inArray(postings.id, nonUs));
  return nonUs.length;
}

/**
 * Re-derives `country` for every Posting from its location text, and writes back
 * the ones that changed. Returns how many rows moved.
 *
 * `country` is written once on ingestion (`storePostings`) and, for legacy rows,
 * on the first match run that extracts them — after that nothing revisits it. So
 * a fix to `extractCountry`'s heuristic (like #67, where `Berlin, DE` had been
 * read as Delaware) does not reach the rows already stored under the old
 * reading. This pass does: run nightly right before `pruneNonUsPostings`, it
 * re-tags the misjudged rows, and the prune then removes the newly-`non-us` ones
 * that no User has acted on.
 *
 * The work is a pure regex over a short string, so the whole Corpus is cheap to
 * walk in one pass; only the changed rows are written, batched.
 */
export async function reclassifyCountries(): Promise<number> {
  const db = getDb();

  const rows = await db
    .select({ id: postings.id, location: postings.location, country: postings.country })
    .from(postings);

  const moves = new Map<Country, string[]>();
  for (const row of rows) {
    const derived = extractCountry(row.location);
    if (derived === row.country) continue;
    const bucket = moves.get(derived);
    if (bucket) bucket.push(row.id);
    else moves.set(derived, [row.id]);
  }

  let moved = 0;
  for (const [country, ids] of moves) {
    for (let i = 0; i < ids.length; i += PRUNE_BATCH_SIZE) {
      const batch = ids.slice(i, i + PRUNE_BATCH_SIZE);
      await db
        .update(postings)
        .set({ country })
        .where(inArray(postings.id, batch));
      moved += batch.length;
    }
  }
  return moved;
}
