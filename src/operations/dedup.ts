import type { Posting } from "@/db/schema";
import { isExpired } from "./postings";

/**
 * Presenting a Dedup Key group: the shared rules for which member of a group of
 * cross-Source duplicates the application shows, and whose Review State the
 * group carries (#13).
 *
 * Grouped Postings are all retained — "when one Source's listing 404s the
 * others are still wanted" — so nothing here writes or deletes. It only decides
 * what a User sees when the same opening was collected from more than one
 * Board.
 */

/** What `chooseRepresentative` weighs — a stored `Posting` supplies all of it. */
type Presentable = Pick<
  Posting,
  "description" | "applyUrl" | "absentFetches" | "source" | "sourceId"
>;

/**
 * The member of a Dedup Key group to present on the Dashboard and Posting page.
 * The order of preference (ADR 0006):
 *
 *  1. A live listing over an Expired one. Not in the spec's ordering, but ahead
 *     of it: showing the dead copy of an opening a User can still apply to
 *     elsewhere is the worse failure, whatever its description looks like.
 *  2. The fullest description (#13) — an aggregator carrying only a snippet
 *     loses to the ATS carrying the whole posting.
 *  3. The most direct apply URL (#13) — a link straight to the employer over an
 *     aggregator's redirector, which carries its real destination in a query
 *     string.
 *  4. Source then Source id, so a group with nothing else to separate its
 *     members still resolves to the same representative on every read.
 */
export function chooseRepresentative<T extends Presentable>(
  group: readonly T[],
): T {
  return [...group].sort(byPresentationPreference)[0];
}

function byPresentationPreference(a: Presentable, b: Presentable): number {
  return (
    Number(isExpired(a)) - Number(isExpired(b)) ||
    b.description.length - a.description.length ||
    applyUrlIndirectness(a.applyUrl) - applyUrlIndirectness(b.applyUrl) ||
    compareStrings(a.source, b.source) ||
    compareStrings(a.sourceId, b.sourceId)
  );
}

/**
 * How much an apply URL looks like a redirector rather than a direct link —
 * lower is more direct. An aggregator bounces through a URL that carries the
 * real posting as a query parameter; an ATS links straight to the posting.
 *
 * A blunt signal on purpose: with one Source live (#5) every group's members
 * are ATS links and the description length decides. Richer heuristics belong
 * with the aggregator Sources that make them matter.
 */
function applyUrlIndirectness(url: string): number {
  try {
    return new URL(url).search ? 1 : 0;
  } catch {
    // Not a URL at all is as indirect as it gets.
    return 2;
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Review State a Dedup Key group carries: the row a User set on any member,
 * so marking one Posting is never silently undone by another listing of the
 * same opening that stayed `new` (#13).
 *
 * In normal use at most one member is ever marked — the Dashboard shows the
 * group once and the User acts on that representative. More than one member
 * carries a row only after a re-Fetch re-grouped Postings whose company, title,
 * or place changed; the most recently updated row wins, being the User's latest
 * word on the opening.
 */
export function latestGroupReview<T extends { updatedAt: Date }>(
  rows: readonly T[],
): T | null {
  return (
    [...rows].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0] ?? null
  );
}
