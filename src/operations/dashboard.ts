import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { matches, postings, type Posting } from "@/db/schema";
import { isExpired } from "./postings";

/**
 * Reading a User's Dashboard: the Postings their Criteria matched, in the order
 * they should be triaged.
 *
 * The Dashboard reads Matches, never the Corpus directly (ADR 0001). Matching
 * has already decided what a User sees and recorded why — this only joins the
 * Posting facts back on and orders them.
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
};

export type Dashboard = {
  /** Matched Postings, newest posted date first. */
  postings: DashboardPosting[];
  /**
   * How many live matched Postings the User has not yet reviewed — the one
   * signal telling them whether opening the app today is worthwhile (#33).
   *
   * Expired Postings are left out: a filled role is not something to open the
   * app for, even if it is still shown so a User can act on one they were
   * tracking. Every live Match counts, for now — Review State (#10) does not
   * exist yet, so nothing is reviewed; once it lands this becomes the count of
   * live Matches with no Review State or a `new` Status.
   */
  unreviewedCount: number;
};

/**
 * Reads one User's Dashboard.
 *
 * Ordered by posted date, newest first, with a Posting whose Source published
 * no date placed last rather than treated as the epoch — an unknown date is not
 * the oldest thing in the Corpus. Expired Postings are returned among the live
 * ones and flagged, never dropped: a role a User is tracking must not disappear
 * because the listing came down (CONTEXT.md, "Expired").
 */
export async function readDashboard(userId: string): Promise<Dashboard> {
  const rows = await getDb()
    .select({ posting: postings, matchedKeywords: matches.matchedKeywords })
    .from(matches)
    .innerJoin(postings, eq(postings.id, matches.postingId))
    .where(eq(matches.userId, userId))
    .orderBy(
      sql`${postings.postedAt} desc nulls last`,
      asc(postings.firstSeenAt),
      asc(postings.source),
      asc(postings.sourceId),
    );

  const list = rows.map(({ posting, matchedKeywords }) => ({
    ...posting,
    matchedKeywords,
    expired: isExpired(posting),
  }));

  return {
    postings: list,
    unreviewedCount: list.filter((posting) => !posting.expired).length,
  };
}
