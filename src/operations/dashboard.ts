import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, postings, reviewState, type Posting } from "@/db/schema";
import { DEFAULT_STATUS, type ReviewStatus } from "@/review/schema";
import { isExpired } from "./postings";

/**
 * Reading a User's Dashboard: the Postings their Criteria matched, in the order
 * they should be triaged.
 *
 * The Dashboard reads Matches, never the Corpus directly (ADR 0001). Matching
 * has already decided what a User sees; this joins the Posting facts and the
 * User's Review State back on, orders them, and applies the Status filter.
 */

/** A matched Posting, with what the Dashboard shows beyond the Corpus facts. */
export type DashboardPosting = Posting & {
  /**
   * The User's keywords found in this Posting's title or description. Empty when
   * the Posting matched on a title alone — the reason it was surfaced is then
   * the title, not a keyword (#35).
   */
  matchedKeywords: string[];
  /** Whether the Board has stopped returning this Posting (#7). */
  expired: boolean;
  /** Where the Posting sits in the User's review pipeline; `new` until touched. */
  status: ReviewStatus;
  /** When the User last marked this `applied`, or null if they never have. */
  appliedAt: Date | null;
};

/**
 * Which Postings the Dashboard shows.
 *
 * A `ReviewStatus` shows exactly that Status. `"all"` shows every matched
 * Posting. The default — no filter — shows everything except `not_interested`,
 * so a Posting a User has dismissed stops taking up room without being lost
 * (#2, user story 40).
 */
export type DashboardFilter = ReviewStatus | "all";

export type Dashboard = {
  /** Matched Postings passing the filter, newest posted date first. */
  postings: DashboardPosting[];
  /** How many Postings match the User's Criteria in total, before the filter. */
  matchedCount: number;
  /**
   * How many live matched Postings the User has not yet reviewed — the one
   * signal telling them whether opening the app today is worthwhile (#33).
   *
   * Independent of the active filter, and of how many Postings are shown:
   * Expired Postings and Postings with any Status but `new` are all left out,
   * whatever the User is currently looking at.
   */
  unreviewedCount: number;
};

/**
 * Reads one User's Dashboard, optionally filtered by Status.
 *
 * Ordered by posted date, newest first, with a Posting whose Source published
 * no date placed last rather than treated as the epoch. Expired Postings are
 * returned among the live ones and flagged, never dropped: a role a User is
 * tracking must not disappear because the listing came down (CONTEXT.md,
 * "Expired").
 */
export async function readDashboard(
  userId: string,
  filter?: DashboardFilter,
): Promise<Dashboard> {
  const rows = await getDb()
    .select({
      posting: postings,
      matchedKeywords: matches.matchedKeywords,
      status: reviewState.status,
      appliedAt: reviewState.appliedAt,
    })
    .from(matches)
    .innerJoin(postings, eq(postings.id, matches.postingId))
    .leftJoin(
      reviewState,
      and(
        eq(reviewState.postingId, matches.postingId),
        eq(reviewState.userId, userId),
      ),
    )
    .where(eq(matches.userId, userId))
    .orderBy(
      sql`${postings.postedAt} desc nulls last`,
      asc(postings.firstSeenAt),
      asc(postings.source),
      asc(postings.sourceId),
    );

  const all = rows.map(({ posting, matchedKeywords, status, appliedAt }) => ({
    ...posting,
    matchedKeywords,
    expired: isExpired(posting),
    status: status ?? DEFAULT_STATUS,
    appliedAt,
  }));

  return {
    postings: all.filter((posting) => shownBy(filter, posting.status)),
    matchedCount: all.length,
    unreviewedCount: all.filter(
      (posting) => !posting.expired && posting.status === DEFAULT_STATUS,
    ).length,
  };
}

/** Whether a Posting with this Status belongs in the current filter's view. */
function shownBy(filter: DashboardFilter | undefined, status: ReviewStatus): boolean {
  if (filter === undefined) return status !== "not_interested";
  if (filter === "all") return true;
  return status === filter;
}
