import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type Posting } from "@/db/schema";
import { DISTANCE_ARRANGEMENTS } from "@/criteria/schema";

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
 * Whether a Posting has stopped being live.
 *
 * Two ways in, one per kind of Source (#15):
 *
 * - An ATS Board's Fetch is its Board's whole state, so a Posting missing from
 *   `ABSENT_FETCHES_UNTIL_EXPIRED` successful Fetches in a row is gone.
 * - An aggregator's Fetch is a bounded slice of a feed spanning thousands of
 *   employers, so absence proves nothing; `expiresAt` carries the close date
 *   the feed published, and a Posting past it is done.
 *
 * Derived rather than stored either way, so there is one answer to "is this
 * Expired" and it cannot fall out of step. An Expired Posting is still in the
 * Corpus — expiry hides a filled role from the Dashboard (#9); it never takes
 * one out of a User's records.
 */
export function isExpired(
  posting: Pick<Posting, "absentFetches" | "expiresAt">,
): boolean {
  if (posting.absentFetches >= ABSENT_FETCHES_UNTIL_EXPIRED) return true;
  return posting.expiresAt != null && posting.expiresAt.getTime() <= Date.now();
}

/**
 * Whether the commute radius was meant to place this Posting but could not (#12).
 *
 * Only meaningful for a User who bounds by distance (`filtersByDistance`): for
 * anyone else the radius never runs and nothing was geocoded, so there is
 * nothing to flag. Among distance-bounded Users, a Posting is unresolved when
 * its text places it onsite or hybrid — the Arrangements the radius acts on —
 * and the geocode cache holds no coordinate for its location: normalization
 * found no place, or the geocoder resolved it to none. Such a Posting is
 * surfaced rather than dropped, and the Dashboard flags it so the miss is
 * visible.
 *
 * A remote Posting, or one whose text names no location mode, is never flagged:
 * the radius does not act on it, so an absent coordinate costs it nothing.
 *
 * `coordinate` is the joined `geocodes` row for the Posting's location — its
 * `latitude` null on a negative result, the whole value null/undefined when no
 * row was joined.
 */
export function hasUnresolvedLocation(
  posting: Pick<Posting, "location" | "arrangements">,
  coordinate: { latitude: number | null } | null | undefined,
  filtersByDistance: boolean,
): boolean {
  if (!filtersByDistance || posting.location == null) return false;

  const commuteRole =
    posting.arrangements.some((arrangement) =>
      (DISTANCE_ARRANGEMENTS as readonly string[]).includes(arrangement),
    ) && !posting.arrangements.includes("remote");
  if (!commuteRole) return false;

  return coordinate == null || coordinate.latitude == null;
}
