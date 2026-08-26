import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type Posting } from "@/db/schema";

/**
 * Reads the whole Corpus, oldest Fetch first.
 *
 * Postings collected by one Fetch all share a `first_seen_at`, so the Source
 * Key breaks the tie: ordering on the row id instead would be ordering on a
 * random UUID, and the order would differ between two identical runs.
 *
 * The Dashboard reads a User's Matches instead (#9); this exists so a Fetch's
 * effect can be observed from outside without a test reaching for the
 * database itself.
 */
export async function listPostings(): Promise<Posting[]> {
  return getDb()
    .select()
    .from(postings)
    .orderBy(
      asc(postings.firstSeenAt),
      asc(postings.source),
      asc(postings.sourceId),
    );
}

/**
 * How many successful Fetches of a Board must miss a Posting before the Board
 * is taken to have stopped returning it.
 *
 * Two rather than one, because one Fetch missing a Posting is as easily a
 * Source hiccup — a paginated response cut short, a role briefly unpublished
 * while it was edited — as a role that was filled, and expiring a live role
 * costs the User an opening they would have applied for.
 */
const ABSENT_FETCHES_UNTIL_EXPIRED = 2;

/**
 * Whether a Board has stopped returning a Posting.
 *
 * Expiry is derived from the absence count rather than stored, so there is one
 * answer to "is this Expired" and it cannot fall out of step with the counting.
 * An Expired Posting is still in the Corpus — expiry hides a filled role from
 * the Dashboard (#9); it never takes one out of a User's records.
 */
export function isExpired(posting: Pick<Posting, "absentFetches">): boolean {
  return posting.absentFetches >= ABSENT_FETCHES_UNTIL_EXPIRED;
}
