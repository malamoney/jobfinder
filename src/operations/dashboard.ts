import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
  criteria,
  matches,
  postings,
  reviewState,
  type Posting,
} from "@/db/schema";
import { DEFAULT_STATUS, type ReviewStatus } from "@/review/schema";
import { chooseRepresentative, latestGroupReview } from "./dedup";
import { anyPlaceResolved } from "./geocoding";
import { hasUnresolvedLocation, isExpired, radiusInEffect } from "./postings";

/**
 * Reading a User's Dashboard: the Postings their Criteria matched, in the order
 * they should be triaged.
 *
 * The Dashboard reads Matches, never the Corpus directly (ADR 0001). Matching
 * has already decided what a User sees; this joins the Posting facts and the
 * User's Review State back on, collapses cross-Source duplicates to one card
 * (#13), orders them, and applies the Status filter.
 *
 * In two halves (#154): the matched Postings read, which changes only when
 * Matching re-runs, and the Review State overlay, which changes with every
 * click. The first is what #155 stores between the events that change it.
 */

/**
 * The Posting facts one Dashboard card renders, plus the few the Dashboard
 * needs but does not show.
 *
 * Spelled out rather than `Posting & {…}` so the read fetches only these
 * columns (#138). The card renders company, title, age, salary, location and
 * Arrangement tags; `dedupKey` groups, `firstSeenAt` / `source` / `sourceId`
 * order and break ties, `absentFetches` / `expiresAt` decide Expired, and
 * `location` / `arrangements` decide the Location-unresolved flag. `description`
 * is the one column left behind — 95% of the row, and nothing here shows it.
 * Every downstream component already takes its own `Pick`, so the card compiles
 * against this narrower type unchanged.
 */
type DashboardPostingFacts = Pick<
  Posting,
  | "id"
  | "company"
  | "title"
  | "postedAt"
  | "applyUrl"
  | "location"
  | "arrangements"
  | "salaryMin"
  | "salaryMax"
  | "salaryPeriod"
  | "dedupKey"
  | "firstSeenAt"
  | "source"
  | "sourceId"
  | "absentFetches"
  | "expiresAt"
>;

/**
 * One opening as the Dashboard shows it: the presented member of its Dedup Key
 * group (#13), carrying what the Dashboard adds beyond the Corpus facts.
 */
export type DashboardPosting = DashboardPostingFacts & {
  /**
   * The User's keywords found in the title or description of any matched member
   * of the group — the union, so a keyword that hit only a listing the
   * Dashboard did not present is still shown. Empty when the opening matched on
   * a title alone (#35).
   */
  matchedKeywords: string[];
  /**
   * Those of `matchedKeywords` the User marked required (#137) — the
   * guaranteed hits, which the card marks apart from the widening ones. Every
   * required keyword is here whenever the User stated any: a Posting is only a
   * Match when it contains all of them (ADR 0017), and so is every member of
   * a Dedup Key group, so the cross-Source union adds nothing to this list.
   * Empty when the User required nothing.
   */
  requiredKeywords: string[];
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
  /**
   * Whether the User has opened this opening's detail page — any listing of it
   * (#13), like the Status. Independent of the Status: a viewed Posting can
   * still be `new`.
   */
  viewed: boolean;
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
  /**
   * How many matched openings the User has marked `interested` — one of the
   * review-pipeline totals the Dashboard can show alongside `unreviewedCount`
   * (#82).
   *
   * A grouped count over Review State: an opening is one however many of its
   * listings carry the mark (#13). Unlike {@link Dashboard.unreviewedCount}
   * this does *not* drop an Expired opening — a decision the User made outlives
   * the listing (CONTEXT.md, "Expired"), whereas an unreviewed Expired role is
   * just noise. Independent of the active filter, like every count here.
   */
  interestedCount: number;
  /**
   * How many matched openings the User has marked `not_interested` (#82).
   * Counted like {@link Dashboard.interestedCount}, Expired ones included, so
   * it holds even though the default view hides these Postings.
   */
  notInterestedCount: number;
  /**
   * How many matched openings the User has marked `applied` (#82). Counted like
   * {@link Dashboard.interestedCount}.
   */
  appliedCount: number;
  /**
   * How many live matched openings were first collected in the last 24 hours —
   * the "new today" figure the Dashboard's stat strip leads with (#81). An
   * opening counts only when every one of its matched listings is that recent
   * (a long-standing role that merely picked up a second Source today is not
   * new) and it is not Expired. Independent of the active filter.
   */
  newTodayCount: number;
};

/** How far back "new today" reaches — a rolling 24-hour window. */
const NEW_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The Posting columns the Dashboard read selects — exactly the
 * {@link DashboardPostingFacts}, no more.
 *
 * {@link DashboardPostingFacts} is written first, as the specification of what
 * the read must fetch; this map is derived from it, and the `satisfies` fails
 * to compile if the two drift apart. `description` is not here — 95% of the row
 * and nothing shows it (#138); its length rides alongside, not within (see
 * {@link dashboardMatchQuery}).
 */
const dashboardPostingColumns = {
  id: postings.id,
  company: postings.company,
  title: postings.title,
  postedAt: postings.postedAt,
  applyUrl: postings.applyUrl,
  location: postings.location,
  arrangements: postings.arrangements,
  salaryMin: postings.salaryMin,
  salaryMax: postings.salaryMax,
  salaryPeriod: postings.salaryPeriod,
  dedupKey: postings.dedupKey,
  firstSeenAt: postings.firstSeenAt,
  source: postings.source,
  sourceId: postings.sourceId,
  absentFetches: postings.absentFetches,
  expiresAt: postings.expiresAt,
} satisfies Record<keyof DashboardPostingFacts, unknown>;

/**
 * The Dashboard's Posting read, as a query (not yet run — callers `await` it,
 * and the regression test calls `.toSQL()` on it).
 *
 * `descriptionLength` is `length(description)` computed in SQL and returned
 * beside the Posting facts rather than among them: `chooseRepresentative` still
 * prefers the fullest listing in a Dedup Key group, but weighs four bytes where
 * selecting the text sent four kilobytes a row (#138), and the number never
 * reaches the card. `length()` counts characters where the old in-JS rule
 * counted UTF-16 units — the two differ only on astral characters, never by
 * enough to change which of two listings is the fuller one.
 *
 * Exposed so a test can assert against its generated SQL that it does not
 * select the description text — the point of #138 is a property, so something
 * has to hold it, and a test that only checked the rendered cards would pass
 * just as well with the column back.
 */
export function dashboardMatchQuery(db: Database, userId: string) {
  return db
    .select({
      posting: dashboardPostingColumns,
      descriptionLength: sql<number>`length(${postings.description})`.mapWith(
        Number,
      ),
      matchedKeywords: matches.matchedKeywords,
      // Whether any of the Posting's places resolved (#113) — a value rather
      // than a join, because a Posting naming three places would otherwise come
      // back as three rows and be counted as three openings.
      placed: anyPlaceResolved,
    })
    .from(matches)
    .innerJoin(postings, eq(postings.id, matches.postingId))
    .where(eq(matches.userId, userId));
}

/**
 * An ISO-8601 timestamp standing in for a `Date` where a value must survive
 * being stored as JSON (#155): `JSON.stringify` turns a `Date` into exactly
 * this, and `new Date(iso)` brings it back to the millisecond.
 */
type Iso = string;

/**
 * The {@link DashboardPostingFacts} with every `Date` spelled as an ISO string
 * — the same facts, in the shape a JSON store hands back unchanged.
 */
type MatchedPostingFacts = Omit<DashboardPostingFacts, DateFact> & {
  postedAt: Iso | null;
  firstSeenAt: Iso;
  expiresAt: Iso | null;
};

/** The keys of `T` whose value is (or may be) a `Date`. */
type DateKeys<T> = {
  [K in keyof T]: Date extends T[K] ? K : never;
}[keyof T];

/**
 * The {@link DashboardPostingFacts} that are dates — what {@link toIso} spells
 * out and {@link fromIso} revives. Derived from the type so a `Date` column
 * added to the facts is listed here by construction; the guard below then fails
 * to compile until the two functions carry it too.
 */
type DateFact = DateKeys<DashboardPostingFacts>;

/**
 * Nothing in the stored half is a `Date`. A type-level assertion rather than a
 * test: the round-trip test would catch a leaked `Date` at runtime, but only
 * after the store had already handed back a string where the card wanted one.
 */
const _matchedPostingIsJsonSafe: DateKeys<MatchedPosting> extends never
  ? true
  : never = true;
void _matchedPostingIsJsonSafe;

/** The facts with every `Date` spelled as ISO — the shape a JSON store keeps. */
function toIso(facts: DashboardPostingFacts): MatchedPostingFacts {
  return {
    ...facts,
    postedAt: facts.postedAt?.toISOString() ?? null,
    firstSeenAt: facts.firstSeenAt.toISOString(),
    expiresAt: facts.expiresAt?.toISOString() ?? null,
  };
}

/**
 * The inverse of {@link toIso}: the facts with their `Date`s back. Generic so
 * whatever rides alongside the facts (the Keywords, the flag) comes through.
 */
function fromIso<T extends MatchedPostingFacts>(
  facts: T,
): Omit<T, DateFact> & Pick<DashboardPostingFacts, DateFact> {
  return {
    ...facts,
    postedAt: facts.postedAt === null ? null : new Date(facts.postedAt),
    firstSeenAt: new Date(facts.firstSeenAt),
    expiresAt: facts.expiresAt === null ? null : new Date(facts.expiresAt),
  };
}

/**
 * One matched opening as the matched Postings read returns it: the presented
 * member of its Dedup Key group, with what Matching decided about it — and
 * nothing the User's clicks or the clock decide.
 *
 * This is the half of the Dashboard read that changes only at a match rebuild
 * or a Criteria save, split out (#154) so it can be read once between those
 * events and stored (#155). So there is no `status`, `appliedAt` or `viewed`
 * here (Review State, which a click changes), and no `expired` or count
 * (which the clock changes): the overlay derives those live from these facts.
 * JSON-round-trip stable, dates included, for the same reason.
 */
export type MatchedPosting = MatchedPostingFacts & {
  /** See {@link DashboardPosting.matchedKeywords}. */
  matchedKeywords: string[];
  /** See {@link DashboardPosting.requiredKeywords}. */
  requiredKeywords: string[];
  /** See {@link DashboardPosting.unresolvedLocation}. */
  unresolvedLocation: boolean;
  /**
   * When the earliest-collected of the group's matched listings was first
   * seen — the fact "new today" (#81) is measured against. An opening is new
   * only when *every* matched listing is recent, which is the same as its
   * earliest one being recent; carried as the one value the overlay needs
   * rather than the whole group's dates.
   */
  earliestFirstSeenAt: Iso;
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
 * listing is lost. Which of those keywords were required is read off the
 * User's Criteria (#137), not the Match — the same row the radius is read from.
 *
 * The composition of two reads that change at different rates (#154): the
 * matched Postings read, which changes only when Matching re-runs, and the
 * Review State overlay, which changes with every click. Kept as one function
 * so the page reads one thing.
 */
export async function readDashboard(
  userId: string,
  filter?: DashboardFilter,
): Promise<Dashboard> {
  return overlayReviewState(await readMatchedPostings(userId), userId, filter);
}

/**
 * The half of the Dashboard read that changes only when Matching re-runs: which
 * openings match this User, which listing of each is presented, the card
 * facts, the matched and required Keywords, and whether the radius could place
 * it.
 *
 * Takes a User id and nothing else — no filter, because the filter is a
 * function of Review State, and no clock. Nothing in the result changes between
 * one match rebuild (or Criteria save) and the next, which is what lets #155
 * read it once between those events. In no particular order: the overlay sorts.
 */
export async function readMatchedPostings(
  userId: string,
): Promise<MatchedPosting[]> {
  const db = getDb();

  // The commute radius as it actually ran for this User — the one condition
  // under which an un-geocoded location is worth flagging (#12, #111).
  const [stated] = await db
    .select()
    .from(criteria)
    .where(eq(criteria.userId, userId));
  const radius = await radiusInEffect(db, stated);
  // Which of a Match's keywords were required is not stored on the Match — a
  // keyword is a string, and its mode lives on the Criteria (#135). Read
  // alongside, the way the radius is: the row Matching last ran against.
  const required = new Set(stated?.requiredKeywords ?? []);

  const rows = await dashboardMatchQuery(db, userId);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.posting.dedupKey);
    if (group) group.push(row);
    else groups.set(row.posting.dedupKey, [row]);
  }

  return [...groups.values()].map((members): MatchedPosting => {
    // `descriptionLength` rides on the row, not the Posting, so it weighs the
    // tie-break here and never reaches the card, which is built from the chosen
    // member's Posting facts alone.
    const winner = chooseRepresentative(
      members.map((member) => ({
        ...member.posting,
        descriptionLength: member.descriptionLength,
      })),
    );
    const shown = members.find((member) => member.posting.id === winner.id)!;
    const representative = shown.posting;
    // Representative first, so the union of matched keywords reads in the order
    // the card's own text would suggest.
    const ordered = [shown, ...members.filter((member) => member !== shown)];

    // Required keywords lead each member's list (`keywordsFound`), and every
    // member carries all of them, so they lead the union too — the card's
    // marked tags come first without a sort here.
    const matchedKeywords = [
      ...new Set(ordered.flatMap((member) => member.matchedKeywords)),
    ];

    return {
      ...toIso(representative),
      matchedKeywords,
      requiredKeywords: matchedKeywords.filter((keyword) =>
        required.has(keyword),
      ),
      unresolvedLocation: hasUnresolvedLocation(
        representative,
        shown.placed,
        radius,
      ),
      earliestFirstSeenAt: new Date(
        Math.min(
          ...members.map((member) => member.posting.firstSeenAt.getTime()),
        ),
      ).toISOString(),
    };
  });
}

/**
 * The half of the Dashboard read that changes with the User's clicks and the
 * clock: lays the Review State marks over a matched Postings list, decides
 * Expired, counts, sorts and filters, and returns the `Dashboard` the page
 * renders.
 *
 * Reads Review State live every time — it is small, and it is the thing the
 * User's own click just changed. Takes the list as a value rather than reading
 * it, so the list can come from the database or from a store (#155) and the
 * page cannot tell which.
 */
export async function overlayReviewState(
  matched: readonly MatchedPosting[],
  userId: string,
  filter?: DashboardFilter,
): Promise<Dashboard> {
  // Review State is read across every member of a group, not just the matched
  // ones: a listing a User marked can drop out of their Matches (its
  // description diverged, so a keyword no longer hits) while a twin stays, and
  // the opening must still read as marked (#13).
  const marksByKey = await readGroupMarks(
    getDb(),
    userId,
    matched.map((opening) => opening.dedupKey),
  );

  // An opening is "new today" when every one of its matched listings was first
  // collected inside the window, and it is not already Expired — the same "not
  // worth opening the app for" exclusion `unreviewedCount` makes (#33).
  const newSince = Date.now() - NEW_TODAY_WINDOW_MS;

  const cards = matched.map((opening) => {
    // `earliestFirstSeenAt` is the group's, not the card's: it decides "new
    // today" here and never reaches the page.
    const { earliestFirstSeenAt, ...facts } = opening;
    const marks = marksByKey.get(opening.dedupKey) ?? [];
    const effective = latestGroupReview(marks);
    const revived = fromIso(facts);
    const expired = isExpired(revived);

    const card: DashboardPosting = {
      ...revived,
      expired,
      status: effective?.status ?? DEFAULT_STATUS,
      appliedAt: effective?.appliedAt ?? null,
      // Viewed is monotonic and not a decision, so it is read as "any listing
      // of this opening has a view", not "the latest mark's view".
      viewed: marks.some((mark) => mark.viewedAt !== null),
    };
    const newToday =
      !expired && new Date(earliestFirstSeenAt).getTime() >= newSince;
    return { card, newToday };
  });

  const newTodayCount = cards.filter(({ newToday }) => newToday).length;
  const all = cards.map(({ card }) => card).sort(byPresentedPostedDate);

  // The review-pipeline counts (#82) read straight off the group-effective
  // Status already resolved onto every opening above — one pass over what is
  // in memory rather than a second trip to the database for figures the
  // Dashboard read has, in effect, already computed.
  const countWithStatus = (status: ReviewStatus) =>
    all.filter((posting) => posting.status === status).length;

  return {
    postings: all.filter((posting) => shownBy(filter, posting.status)),
    matchedCount: all.length,
    unreviewedCount: all.filter(
      (posting) => !posting.expired && posting.status === DEFAULT_STATUS,
    ).length,
    interestedCount: countWithStatus("interested"),
    notInterestedCount: countWithStatus("not_interested"),
    appliedCount: countWithStatus("applied"),
    newTodayCount,
  };
}

/** One Review State mark, keyed back to the group's Dedup Key. */
type GroupMark = {
  dedupKey: string;
  status: ReviewStatus;
  appliedAt: Date | null;
  updatedAt: Date;
  viewedAt: Date | null;
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
      viewedAt: reviewState.viewedAt,
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
