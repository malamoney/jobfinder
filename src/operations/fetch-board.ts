import { getTableColumns, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type SourceName } from "@/db/schema";
import { fetchGreenhouseBoard } from "@/sources/greenhouse";
import type { SourcePosting } from "@/sources/types";

/**
 * One company's listings within a Source, addressed by its Slug.
 *
 * Carries the curated set's own id as well as the address, because a Posting
 * records which Board published it by reference. Fetching therefore only
 * happens against a Board the application knows about — a Slug being probed
 * for the first time (#18) is a candidate, and its jobs do not belong in the
 * shared Corpus until someone promotes it.
 */
export type Board = {
  id: string;
  source: SourceName;
  slug: string;
};

/** The adapter each Source is reached through. */
const ADAPTERS: Record<SourceName, (slug: string) => Promise<SourcePosting[]>> =
  {
    greenhouse: fetchGreenhouseBoard,
  };

/**
 * Fetches one Board and writes its Postings into the Corpus.
 *
 * Throws if the Board could not be fetched or its response could not be
 * understood, and writes nothing in that case. The distinction between a Board
 * that failed and a Board that returned nothing is what expiry rests on
 * (#7): only a Fetch that returned is evidence a Posting is gone.
 */
export async function fetchBoard(board: Board): Promise<void> {
  const fetched = await ADAPTERS[board.source](board.slug);
  await storePostings(board, fetched);
}

/**
 * The columns a re-Fetch must not touch: the Posting's identity, and the date
 * the Corpus first met it.
 */
const PRESERVED_ON_REFETCH = new Set([
  "id",
  "source",
  "sourceId",
  "firstSeenAt",
]);

/**
 * What a re-Fetch overwrites, derived from the table rather than listed by
 * hand.
 *
 * A hand-written list is one column-addition away from silently going stale —
 * the new field would be written on insert and then never refreshed, so an
 * edited Posting would keep its first value forever with nothing failing.
 */
const REFRESHED_ON_REFETCH: Record<string, SQL> = Object.fromEntries(
  Object.entries(getTableColumns(postings))
    .filter(([property]) => !PRESERVED_ON_REFETCH.has(property))
    .map(([property, column]) => [
      property,
      property === "lastSeenAt"
        ? sql`now()`
        : sql.raw(`excluded.${column.name}`),
    ]),
);

/**
 * Upserts Postings on their Source Key, so a Posting already in the Corpus is
 * updated rather than duplicated.
 *
 * Every field the Source publishes is overwritten — a company that edited a
 * description means the old one is wrong — and `last_seen_at` records that
 * this Fetch saw it.
 */
async function storePostings(
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  if (fetched.length === 0) return;

  await getDb()
    .insert(postings)
    .values(fetched.map((posting) => ({ ...posting, boardId: board.id })))
    .onConflictDoUpdate({
      target: [postings.source, postings.sourceId],
      set: REFRESHED_ON_REFETCH,
    });
}
