import {
  and,
  eq,
  getTableColumns,
  notInArray,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
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
 * Fetches one Board and reconciles the Corpus with what it returned: the
 * Postings it listed are stored, and the ones it no longer lists are counted
 * as absent, which is how they eventually expire (#7).
 *
 * Throws if the Board could not be fetched or its response could not be
 * understood, and writes nothing in that case. That is ADR 0004's invariant,
 * and it is structural here rather than remembered: the adapter throws before
 * there is anything to reconcile against, so a Board that failed cannot reach
 * the code that reads absence as evidence.
 *
 * The two writes are one transaction because they are one statement about the
 * Board: a Fetch half-applied would have moved some Postings towards expiry
 * without recording that the others were seen.
 */
export async function fetchBoard(board: Board): Promise<void> {
  const fetched = await ADAPTERS[board.source](board.slug);

  await getDb().transaction(async (tx) => {
    await storePostings(tx, board, fetched);
    await countAbsences(tx, board, fetched);
  });
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
    .map(([property, column]) => [property, refreshed(property, column)]),
);

/**
 * What a re-Fetch writes into one column.
 *
 * Two columns are facts about the Fetch rather than about the job, so they are
 * written from what just happened instead of from the row being inserted: this
 * Fetch saw the Posting, so it was last seen now, and it has not been absent
 * from any Fetch since — which is what un-expires a role a company re-listed.
 */
function refreshed(property: string, column: Column): SQL {
  if (property === "lastSeenAt") return sql`now()`;
  if (property === "absentFetches") return sql`0`;
  return sql.raw(`excluded.${column.name}`);
}

/**
 * Upserts Postings on their Source Key, so a Posting already in the Corpus is
 * updated rather than duplicated.
 *
 * Every field the Source publishes is overwritten — a company that edited a
 * description means the old one is wrong — and `last_seen_at` records that
 * this Fetch saw it.
 */
async function storePostings(
  tx: Transaction,
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  if (fetched.length === 0) return;

  await tx
    .insert(postings)
    .values(fetched.map((posting) => ({ ...posting, boardId: board.id })))
    .onConflictDoUpdate({
      target: [postings.source, postings.sourceId],
      set: REFRESHED_ON_REFETCH,
    });
}

/**
 * Counts this Fetch against every Posting of the Board it did not return.
 *
 * Absence is all any Source offers — none of them publish a "this job is
 * closed" signal — so a Posting the Board has stopped listing is counted
 * rather than judged, and `isExpired` decides how many misses in a row make a
 * Posting Expired. Nothing here deletes: a Posting a User marked `applied`
 * outlives the listing.
 *
 * Only this Board's Postings are in range. A sweep fetches hundreds of Boards
 * and every Posting is absent from all but one of them.
 */
async function countAbsences(
  tx: Transaction,
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  const returned = fetched.map((posting) => posting.sourceId);
  const onThisBoard = eq(postings.boardId, board.id);

  await tx
    .update(postings)
    .set({ absentFetches: sql`${postings.absentFetches} + 1` })
    .where(
      // A Board whose last role was filled returns an empty list, and every
      // Posting on it is absent. Spelling that out rather than leaving it to
      // `notInArray` of nothing keeps the Board this ADR is written about —
      // the one that suddenly returns nothing — from turning on a subtlety.
      returned.length === 0
        ? onThisBoard
        : and(onThisBoard, notInArray(postings.sourceId, returned)),
    );
}
