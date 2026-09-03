import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Writer } from "@/db";
import { postings, type CriteriaRow, type Posting } from "@/db/schema";
import { radiusAppliesTo } from "@/commute/radius-scope";
import { radiusOrigin } from "./home-location";

/**
 * Whether a string could be a Posting's id, before it reaches a `uuid` column.
 *
 * Every read that takes an id from a URL asks this first: an id that is not
 * even a UUID is turned away with the same answer as one that names no
 * Posting, rather than left to error inside the query.
 */
export function isPostingId(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

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
 * The commute radius as it actually ran for a User, or null when it did not run
 * at all.
 *
 * It carries the Arrangements the User accepts, because those are what decide
 * which Postings the radius acts on (`radiusApplies`). Null covers both ways
 * the stage declines to run: no radius stated, and no home point to measure
 * from.
 */
export type RadiusInEffect = Pick<CriteriaRow, "arrangements"> | null;

/**
 * The radius in effect for a User, read from their stored Criteria.
 *
 * Asks `radiusOrigin` the same question the stage asks, rather than testing
 * `radiusMiles` alone: a User whose stated home could not be placed has a
 * radius that never ran, and a flag that fired for them would announce a miss
 * that nothing was ever measured against.
 */
export async function radiusInEffect(
  writer: Writer,
  stated: CriteriaRow | undefined,
): Promise<RadiusInEffect> {
  if (!stated) return null;
  return (await radiusOrigin(writer, stated)) ? stated : null;
}

/**
 * Whether the commute radius was meant to place this Posting but could not (#12).
 *
 * Only meaningful for a User whose radius actually ran (`radiusInEffect`):
 * without a radius, or without a home point to measure from, the stage never
 * runs and an absent coordinate means nothing (ADR 0005). For the rest, a
 * Posting is unresolved when the radius would have measured it and the geocode
 * cache holds no coordinate for its location — normalization found no place, or
 * the geocoder resolved it to none. Such a Posting is surfaced rather than
 * dropped, and the Dashboard flags it so the miss is visible.
 *
 * Which Postings the radius would have measured is `radiusApplies`
 * (`@/commute/radius-scope`), the same statement the stage itself reads, so the
 * pill lands on precisely the Postings the radius could not place. It used to
 * ask its own question — "onsite or hybrid, and not remote" — which stopped
 * being the radius's question when ADR 0013 scoped the radius by the User's
 * stance on remote. The flag then went silent on exactly the Postings it exists
 * for: a role tagged both remote and hybrid, shown to a User who accepts
 * neither remote nor that commute, was measured by nothing and announced by
 * nothing (#111).
 *
 * `coordinate` is the joined `geocodes` row for the Posting's location — its
 * `latitude` null on a negative result, the whole value null/undefined when no
 * row was joined.
 */
export function hasUnresolvedLocation(
  posting: Pick<Posting, "location" | "arrangements">,
  coordinate: { latitude: number | null } | null | undefined,
  radius: RadiusInEffect,
): boolean {
  if (radius == null || posting.location == null) return false;
  if (!radiusAppliesTo(radius.arrangements, posting.arrangements)) return false;

  return coordinate == null || coordinate.latitude == null;
}
