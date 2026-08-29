import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
  criteria,
  geocodes,
  matches,
  postings,
  reviewState,
  type Posting,
} from "@/db/schema";
import { DEFAULT_STATUS, type ReviewStatus } from "@/review/schema";
import { chooseRepresentative, latestGroupReview } from "./dedup";
import { hasUnresolvedLocation, isExpired } from "./postings";

/**
 * Reading a User's Dashboard: the Postings their Criteria matched, in the order
 * they should be triaged.
 *
 * The Dashboard reads Matches, never the Corpus directly (ADR 0001). Matching
 * has already decided what a User sees; this joins the Posting facts and the
 * User's Review State back on, collapses cross-Source duplicates to one card
 * (#13), orders them, and applies the Status filter.
 */

/**
 * One opening as the Dashboard shows it: the presented member of its Dedup Key
 * group (#13), carrying what the Dashboard adds beyond the Corpus facts.
 */
export type DashboardPosting = Posting & {
  /**
   * The User's keywords found in the title or description of any matched member
   * of the group — the union, so a keyword that hit only a listing the
   * Dashboard did not present is still shown. Empty when the opening matched on
   * a title alone (#35).
   */
  matchedKeywords: string[];
  /** Whether the Board has stopped returning this Posting (#7). */
  expired: boolean;
  /**
   * Whether the Posting names a place that could not be geocoded (#12). The
   * radius was not applied to it — it is shown so it is not silently lost.
   */
  unresolvedLocation: boolean;
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
  /** One card per matched opening passing the filter, newest posted date first. */
  postings: DashboardPosting[];
  /**
   * How many openings match the User's Criteria in total, before the filter —
   * cross-Source duplicates counted once (#13).
   */
  matchedCount: number;
  /**
   * How many live matched openings the User has not yet reviewed — the one
   * signal telling them whether opening the app today is worthwhile (#33).
   *
   * Independent of the active filter, and of how many cards are shown: an
   * opening whose group is entirely Expired, and one the group carries any
   * Status but `new` for, are both left out, whatever the User is looking at.
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
 *
 * A matched opening collected from more than one Board appears once (#13): its
 * Postings are grouped by Dedup Key, one is chosen to present
 * (`chooseRepresentative`), and the openings are ordered by that presented
 * listing's posted date. The group's Status, applied date, and matched keywords
 * are drawn from across the group's members so nothing a User did to one
 * listing is lost.
 */
export async function readDashboard(
  userId: string,
  filter?: DashboardFilter,
): Promise<Dashboard> {
  const db = getDb();

  // Whether this User bounds their search by distance — the one condition under
  // which an un-geocoded location is worth flagging (#12).
  const [stated] = await db
    .select({ radiusMiles: criteria.radiusMiles })
    .from(criteria)
    .where(eq(criteria.userId, userId));
  const filtersByDistance = stated?.radiusMiles != null;

  const rows = await db
    .select({
      posting: postings,
      matchedKeywords: matches.matchedKeywords,
      coordinate: {
        latitude: geocodes.latitude,
        longitude: geocodes.longitude,
      },
    })
    .from(matches)
    .innerJoin(postings, eq(postings.id, matches.postingId))
    .leftJoin(geocodes, eq(geocodes.location, postings.normalizedLocation))
    .where(eq(matches.userId, userId));

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.posting.dedupKey);
    if (group) group.push(row);
    else groups.set(row.posting.dedupKey, [row]);
  }

  // Review State is read across every member of a group, not just the matched
  // ones: a listing a User marked can drop out of their Matches (its
  // description diverged, so a keyword no longer hits) while a twin stays, and
  // the opening must still read as marked (#13).
  const marksByKey = await readGroupMarks(db, userId, [...groups.keys()]);

  const all = [...groups.values()].map((members): DashboardPosting => {
    const representative = chooseRepresentative(
      members.map((member) => member.posting),
    );
    const shown = members.find(
      (member) => member.posting.id === representative.id,
    )!;
    // Representative first, so the union of matched keywords reads in the order
    // the card's own text would suggest.
    const ordered = [shown, ...members.filter((member) => member !== shown)];
    const effective = latestGroupReview(
      marksByKey.get(representative.dedupKey) ?? [],
    );

    return {
      ...representative,
      matchedKeywords: [
        ...new Set(ordered.flatMap((member) => member.matchedKeywords)),
      ],
      expired: isExpired(representative),
      unresolvedLocation: hasUnresolvedLocation(
        representative,
        shown.coordinate,
        filtersByDistance,
      ),
      status: effective?.status ?? DEFAULT_STATUS,
      appliedAt: effective?.appliedAt ?? null,
    };
  });

  all.sort(byPresentedPostedDate);

  return {
    postings: all.filter((posting) => shownBy(filter, posting.status)),
    matchedCount: all.length,
    unreviewedCount: all.filter(
      (posting) => !posting.expired && posting.status === DEFAULT_STATUS,
    ).length,
  };
}

/** One Review State mark, keyed back to the group's Dedup Key. */
type GroupMark = {
  dedupKey: string;
  status: ReviewStatus;
  appliedAt: Date | null;
  updatedAt: Date;
};

/**
 * Every Review State row this User has on any Posting in the given Dedup Key
 * groups, bucketed by group. Empty when the User has marked nothing.
 */
async function readGroupMarks(
  db: Database,
  userId: string,
  keys: string[],
): Promise<Map<string, GroupMark[]>> {
  const byKey = new Map<string, GroupMark[]>();
  if (keys.length === 0) return byKey;

  const marks = await db
    .select({
      dedupKey: postings.dedupKey,
      status: reviewState.status,
      appliedAt: reviewState.appliedAt,
      updatedAt: reviewState.updatedAt,
    })
    .from(reviewState)
    .innerJoin(postings, eq(postings.id, reviewState.postingId))
    .where(
      and(
        eq(reviewState.userId, userId),
        inArray(postings.dedupKey, keys),
      ),
    );

  for (const mark of marks) {
    const bucket = byKey.get(mark.dedupKey);
    if (bucket) bucket.push(mark);
    else byKey.set(mark.dedupKey, [mark]);
  }
  return byKey;
}

/**
 * The triage order: by the presented listing's posted date, newest first, a
 * listing whose Source published no date placed last rather than at the epoch,
 * then oldest in the Corpus and finally by Source Key so the order is total.
 */
function byPresentedPostedDate(a: DashboardPosting, b: DashboardPosting): number {
  const at = a.postedAt?.getTime() ?? null;
  const bt = b.postedAt?.getTime() ?? null;
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  }
  return (
    a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
    a.source.localeCompare(b.source) ||
    a.sourceId.localeCompare(b.sourceId)
  );
}

/** Whether a Posting with this Status belongs in the current filter's view. */
function shownBy(filter: DashboardFilter | undefined, status: ReviewStatus): boolean {
  if (filter === undefined) return status !== "not_interested";
  if (filter === "all") return true;
  return status === filter;
}
