import {
  and,
  arrayOverlaps,
  eq,
  ilike,
  isNotNull,
  isNull,
  not,
  or,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  criteria,
  matches,
  postings,
  type CriteriaRow,
  type Posting,
} from "@/db/schema";
import {
  DISTANCE_ARRANGEMENTS,
  EMPLOYMENT_ARRANGEMENTS,
  LOCATION_ARRANGEMENTS,
  type Arrangement,
} from "@/criteria/schema";
import { EARTH_RADIUS_MILES } from "@/commute/distance";
import { radiusApplies, type Logic } from "@/commute/radius-scope";
import { normalizeLocations } from "@/postings/location";
import { WORKING_HOURS_PER_YEAR } from "@/postings/salary";
import type { Coordinate } from "@/geocoding/nominatim";
import { extractPostings } from "./extraction";
import { anyPlaceResolved, anyPlaceWhere, ensureGeocoded } from "./geocoding";
import { placeUnplacedHome, radiusOrigin } from "./home-location";

/**
 * The matching funnel: the ordered, deterministic stages that turn a User's
 * Criteria and the shared Corpus into their Matches.
 *
 * No LLM is involved. Every stage is a literal comparison a database can do, so
 * a Criteria change re-matches the entire Corpus with no time bound — there is
 * nothing to spend by recomputing everything (ADR 0001).
 *
 * The funnel is a list of stages run in order, each narrowing the Postings the
 * previous one let through. The parent spec (#2) names four: SQL over
 * source-structured fields; literal title and keyword text matching; Extraction
 * over the survivors; SQL over the extracted fields for salary, Arrangement,
 * and distance.
 *
 * Extraction is what splits the run in two. The stages before it are cheap and
 * read only what a Source published; the stages after it read fields Extraction
 * derives, and Extraction runs over the survivors of the cheap stages alone —
 * never the whole Corpus (#11). Distance (#12) is another derived stage: it
 * needs both the extracted Arrangements and the geocoded location.
 */

/**
 * What a derived stage may need beyond the stored Criteria: the User's home
 * coordinate, resolved once per match run.
 *
 * Null when the User set no radius, or when their home location could not be
 * geocoded — the distance stage cannot filter without a point to measure from,
 * and showing every role beats hiding a commutable one.
 */
type MatchContext = {
  home: Coordinate | null;
};

/** One stage of the funnel. */
type FunnelStage = {
  /** What the stage does, so `FUNNEL` reads as an ordered list. */
  name: string;
  /**
   * Whether this stage reads fields that Extraction derives. A derived stage
   * runs only after Extraction has filled those fields for the survivors of the
   * cheap stages.
   */
  derived?: boolean;
  /**
   * A predicate over `postings` keeping only the rows this stage accepts, or
   * `undefined` when these Criteria give the stage nothing to filter on.
   */
  narrow(stated: CriteriaRow, context: MatchContext): SQL | undefined;
};

/**
 * Matches a column against `value` as a literal, case-insensitively.
 *
 * The characters `LIKE` treats as wildcards are escaped, so a keyword like
 * `c++` or `100%` matches the text a User meant and not a pattern.
 */
function contains(column: Column, value: string): SQL {
  const escaped = value.replace(/([\\%_])/g, "\\$1");
  return ilike(column, `%${escaped}%`);
}

/**
 * Literal title and keyword matching against the Posting's title and
 * description.
 *
 * A Posting is kept if a stated title occurs in its title, or a stated keyword
 * occurs in its title or description. Matching is by substring, so a title of
 * "Staff Engineer" surfaces "Staff Engineer, Infrastructure" — a User who wants
 * a narrower net states a narrower title.
 *
 * Keywords widen the net rather than narrowing it: a role found by a keyword in
 * its description is one a title list alone would have missed (#2, user story
 * 9). That is why this is one stage with an `or` inside, not two in sequence.
 * Keywords are optional — with none stated this is title matching alone.
 */
const titleAndKeywordMatch: FunnelStage = {
  name: "literal title and keyword match",
  narrow({ titles, keywords }) {
    return or(
      ...titles.map((title) => contains(postings.title, title)),
      ...keywords.flatMap((keyword) => [
        contains(postings.title, keyword),
        contains(postings.description, keyword),
      ]),
    );
  },
};

/**
 * Minimum salary, over the pay Extraction derived.
 *
 * Excludes a Posting only when it *states* a salary below the floor. The
 * Posting's `salary_max` is in its own unit, so an hourly rate is annualised
 * here — with the same factor `@/postings/salary` uses — before the comparison.
 * A Posting whose text stated no salary has `salary_max` null and always
 * passes: unknown is not zero (CONTEXT.md, "Criteria"), and excluding every
 * Posting that lists nothing would discard most of the market.
 */
const minimumSalary: FunnelStage = {
  name: "minimum salary over extracted pay",
  derived: true,
  narrow({ minSalary }) {
    if (minSalary == null) return undefined;
    const annualisedMax = sql`${postings.salaryMax} * case when ${postings.salaryPeriod} = 'hour' then ${WORKING_HOURS_PER_YEAR} else 1 end`;
    return or(isNull(postings.salaryMax), sql`${annualisedMax} >= ${minSalary}`);
  },
};

/**
 * Accepted Arrangements, over the structure Extraction derived.
 *
 * "Never see roles structured in a way I cannot take" (#2, user story 11).
 * Arrangement is two independent axes — where the work happens and the
 * employment type — and a Posting is excluded only when, on an axis the User
 * constrained, everything its text says about that axis falls outside what the
 * User accepts.
 *
 * An axis the Posting's text is silent on never excludes it (unknown, the same
 * way an absent salary passes a floor). An axis the User selected nothing on is
 * not a constraint — a User who ticks only "remote" is saying nothing about
 * employment type, not rejecting every full-time role.
 */
const acceptedArrangements: FunnelStage = {
  name: "accepted arrangements over extracted structure",
  derived: true,
  narrow({ arrangements }) {
    const perAxis = [LOCATION_ARRANGEMENTS, EMPLOYMENT_ARRANGEMENTS]
      .map((axis) => axisClause(arrangements, axis))
      .filter((clause): clause is SQL => clause !== undefined);
    return perAxis.length ? and(...perAxis) : undefined;
  },
};

/**
 * Keeps a Posting unless its text places it wholly outside the User's choices
 * on one axis. `undefined` when the User constrained nothing on that axis.
 */
function axisClause(
  accepted: readonly Arrangement[],
  axis: readonly Arrangement[],
): SQL | undefined {
  const wanted = axis.filter((value) => accepted.includes(value));
  if (wanted.length === 0) return undefined;

  return or(
    // The Posting's text names nothing on this axis — unknown, so keep it.
    not(arrayOverlaps(postings.arrangements, [...axis])),
    // Or something it does name is one the User accepts.
    arrayOverlaps(postings.arrangements, [...wanted]),
  );
}

/**
 * The commute radius, over the geocoded location.
 *
 * "A hybrid role four hundred miles away is exactly as uncommutable as an
 * onsite one" (#12): a role at a fixed address that is too far to reach is
 * excluded. What counts as "at a fixed address" depends on whether the User
 * accepts remote work, and that rule is stated once — `radiusApplies`
 * (`@/commute/radius-scope`), read here as SQL and by the **Location
 * unresolved** flag as a plain boolean, so the two cannot disagree about which
 * Postings were measured (#111).
 *
 * A Posting whose location could not be geocoded is *kept* either way, not
 * dropped: silently dropping it is how a User loses a role they wanted and
 * never finds out (#12). The Dashboard flags it as unresolved instead.
 *
 * A Posting may name several places (#113), and the one that decides is the
 * closest: a role offered in Boston and Seattle is a Boston role to somebody in
 * Franklin, MA. So the radius drops a Posting only when *every* place it could
 * put on a map is too far, and keeps it when any one of them is in range —
 * which is the same rule a single-place Posting has always been read by.
 *
 * The distance is a great-circle computation in SQL against the `geocodes`
 * cache, which `matchCriteria` has already filled for every surviving location.
 */
const withinCommuteRadius: FunnelStage = {
  name: "commute radius over the geocoded location",
  derived: true,
  narrow({ radiusMiles, arrangements }, { home }) {
    if (radiusMiles == null || !home) return undefined;

    const measured = radiusApplies(
      arrangements,
      {
        namesDistanceArrangement: arrayOverlaps(postings.arrangements, [
          ...DISTANCE_ARRANGEMENTS,
        ]),
        offersRemote: arrayOverlaps(postings.arrangements, [
          "remote",
        ] satisfies Arrangement[]),
      },
      SQL_LOGIC,
    );

    // Any one of the Posting's places that the cache resolved to a point inside
    // the radius. A place with no resolved point — no cache row, or a negative
    // result — is not a place this can be true of, so a Posting nothing could
    // place matches nothing here. `anyPlaceWhere` is the same statement of
    // "a resolved place of this Posting" that `anyPlaceResolved` is built from,
    // with the distance asked of it.
    const somewhereInRange = anyPlaceWhere(sql`
      ${EARTH_RADIUS_MILES} * acos(least(1, greatest(-1,
        sin(radians(${home.latitude})) * sin(radians(g.latitude))
        + cos(radians(${home.latitude})) * cos(radians(g.latitude))
          * cos(radians(g.longitude) - radians(${home.longitude}))
      ))) <= ${radiusMiles}
    `);

    // Three ways to survive the stage, and the middle one is what keeps an
    // unplaceable Posting surfaced: the radius does not act on this Posting for
    // this User; nothing it names could be placed at all; or something it names
    // is close enough. Only a Posting whose every resolved place is too far is
    // dropped.
    return or(not(measured), not(anyPlaceResolved), somewhereInRange);
  },
};

/** The radius rule's boolean algebra, in SQL. */
const SQL_LOGIC: Logic<SQL> = {
  // Two defined operands always combine to a clause; `and` is only `undefined`
  // when it is given nothing to combine.
  and: (left, right) => and(left, right)!,
  not,
  always: sql`true`,
};

/** The stages, in the order they run. */
const FUNNEL: FunnelStage[] = [
  titleAndKeywordMatch,
  minimumSalary,
  acceptedArrangements,
  withinCommuteRadius,
];

/**
 * The combined predicate of the given stages, or `undefined` when none of them
 * narrowed anything.
 *
 * `undefined` is read by Matching as "select nothing", not "select the Corpus":
 * Criteria that pick out no Postings should surface none. Valid Criteria always
 * state a title, so the cheap stages always narrow — this is a guard, not a
 * path taken.
 */
function combine(
  stages: FunnelStage[],
  stated: CriteriaRow,
  context: MatchContext,
): SQL | undefined {
  return and(...stages.map((stage) => stage.narrow(stated, context)));
}

/** The context the cheap stages run under; none of them read it. */
const NO_CONTEXT: MatchContext = { home: null };

/**
 * Fills the geocode cache with the locations a distance-bounded match run
 * needs — the survivors of the cheap stages, plus the User's home.
 *
 * Runs before the match transaction opens, on a plain handle: a warm-up run
 * makes one external call per uncached string, and none of that should hold the
 * User's `matches` rows locked. What it geocodes is read straight back out of
 * the cache inside the transaction (the distance stage's subquery). A no-op when
 * the User set no radius, or once the Corpus's locations are all cached.
 *
 * Only Posting locations are warmed into the cache. The User's home is resolved
 * when they save their Criteria and kept on that row (#100, ADR 0014), so it
 * never enters the shared cache — and a row that reaches here without a point,
 * because it was stated before that or because the geocoder was down when it was
 * saved, is placed here rather than left to depend on the cache. The batch is
 * bounded by `ensureGeocoded` — a Fetch that introduced hundreds of new
 * locations is drained a batch per match run, not all at once inside one
 * request.
 *
 * The Criteria are read here and again in the transaction; a change in between
 * only means the cache was warmed for a slightly different survivor set, which
 * the next run settles.
 */
async function warmGeocodesForMatch(userId: string): Promise<void> {
  const db = getDb();

  const [stated] = await db
    .select()
    .from(criteria)
    .where(eq(criteria.userId, userId));
  if (!stated) return;

  // Nothing to measure without a radius, and nothing to measure it from
  // without a home — either way the distance stage will not run, so the Corpus
  // needs no coordinates for this User.
  if (stated.radiusMiles == null || !stated.homeLocation) return;

  // Place a home that has no point yet, before the transaction reads it back.
  await placeUnplacedHome(stated);

  const cheap = combine(
    FUNNEL.filter((stage) => !stage.derived),
    stated,
    NO_CONTEXT,
  );
  if (!cheap) return;

  const located = await db
    .selectDistinct({ location: postings.location })
    .from(postings)
    .where(and(cheap, isNotNull(postings.location)));

  const keys = new Set<string>();
  for (const row of located) {
    for (const key of normalizeLocations(row.location)) keys.add(key);
  }

  await ensureGeocoded(db, [...keys]);
}

/**
 * Which of the User's keywords occur literally in a Posting's title or
 * description — the same substring, case-insensitive test `contains` makes in
 * SQL, so what the Dashboard shows against a Posting cannot disagree with why
 * it was surfaced.
 */
function keywordsFoundIn(
  posting: Pick<Posting, "title" | "description">,
  keywords: readonly string[],
): string[] {
  const haystack = `${posting.title}\n${posting.description}`.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * Recomputes a User's Matches over the entire Corpus.
 *
 * Matches are derived (ADR 0001): this discards the User's Matches and rebuilds
 * them from scratch, so a Criteria edit that dropped a keyword cannot leave a
 * Match it used to justify behind. `saveCriteria` calls this on every save, and
 * `matchAllUsers` calls it for everyone after a Fetch and behind the Dashboard's
 * "Run matching now" (#17).
 *
 * One transaction, and the Criteria are read inside it, so the rebuild cannot
 * race a concurrent save and land against a statement that no longer exists.
 * Postings collected before this Criteria statement existed are matched like any
 * other — the Corpus has no notion of which Fetch brought a Posting in.
 *
 * The transaction is two queries around Extraction: the cheap stages select the
 * survivors, Extraction fills the derived fields for those survivors only, and
 * the full funnel then selects the Matches. Re-running the cheap stages in the
 * second query is deliberate — they are free, and it avoids carrying a list of
 * thousands of ids between the two.
 *
 * Geocoding for the distance stage (#12) is done first, outside the transaction
 * (`warmGeocodesForMatch`), so its external calls never hold the User's Matches
 * locked. It is a no-op unless the User bounds their search by distance.
 */
export async function matchCriteria(userId: string): Promise<void> {
  // Distance (#12): fill the geocode cache before the transaction opens, so a
  // warm-up run's external calls never hold this User's `matches` rows locked
  // across the network. A no-op when the User set no radius.
  await warmGeocodesForMatch(userId);

  await getDb().transaction(async (tx) => {
    await tx.delete(matches).where(eq(matches.userId, userId));

    const [stated] = await tx
      .select()
      .from(criteria)
      .where(eq(criteria.userId, userId));
    if (!stated) return;

    const cheapStages = FUNNEL.filter((stage) => !stage.derived);
    const cheap = combine(cheapStages, stated, NO_CONTEXT);
    if (!cheap) return;

    // Extraction over the survivors of the cheap stages only (#11). Cached on
    // the Posting, so a survivor a previous match already extracted costs
    // nothing here.
    await extractPostings(tx, cheap);

    // Distance (#12): the radius stage measures in SQL against the geocode
    // cache `warmGeocodesForMatch` has already filled.
    const context: MatchContext = {
      home: await radiusOrigin(tx, stated),
    };

    const full = combine(FUNNEL, stated, context);
    if (!full) return;

    const hits = await tx.select().from(postings).where(full);
    if (hits.length === 0) return;

    await tx.insert(matches).values(
      hits.map((posting) => ({
        userId,
        postingId: posting.id,
        matchedKeywords: keywordsFoundIn(posting, stated.keywords),
      })),
    );
  });
}

/**
 * Re-matches every User who has stated Criteria.
 *
 * The nightly Fetch runs this once it has collected, so a User's Dashboard
 * shows Postings that arrived overnight without their having to touch anything
 * (#2, user story 20; #17). "Run matching now" on the Dashboard re-matches one
 * User the same way, on demand.
 *
 * Sequential, each User its own transaction: a partial failure leaves the Users
 * already done correctly matched, and the geocode cache one User's run fills
 * serves the next.
 */
export async function matchAllUsers(): Promise<void> {
  const stated = await getDb()
    .select({ userId: criteria.userId })
    .from(criteria);

  for (const { userId } of stated) {
    await matchCriteria(userId);
  }
}
