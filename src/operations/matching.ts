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
import { getDb, type Transaction } from "@/db";
import {
  criteria,
  geocodes,
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
import { normalizeLocation } from "@/postings/location";
import { WORKING_HOURS_PER_YEAR } from "@/postings/salary";
import type { Coordinate } from "@/geocoding/nominatim";
import { extractPostings } from "./extraction";
import { ensureGeocoded, readGeocode } from "./geocoding";

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

/** Earth's mean radius in miles, for the great-circle distance in SQL. */
const EARTH_RADIUS_MILES = 3958.7559;

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
 * United States only, over the country Extraction derived from the location
 * text (ADR 0009).
 *
 * The one funnel stage that excludes on a *silent* signal. Every other stage
 * leaves a Posting alone when its text says nothing on the axis — an absent
 * salary passes a floor, an unstated Arrangement is not rejected. This one
 * keeps only `country = 'us'`, so a role placed abroad, a remote role, and a
 * role that names no place are all dropped together. That is the point: a User
 * who ticks "United States only" is saying "not the ones I cannot tell", and
 * `unknown` is overwhelmingly a bare "Remote" — exactly the case the tick is
 * for.
 */
const unitedStatesOnly: FunnelStage = {
  name: "united states only over extracted country",
  derived: true,
  narrow({ usOnly }) {
    return usOnly ? eq(postings.country, "us") : undefined;
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
 * onsite one" (#12): the radius applies to onsite and hybrid Postings and to
 * nothing else. A remote Posting ignores it. A Posting whose text names no
 * location mode is left alone too — unknown is not "commute", the same way the
 * Arrangement stage never excludes on a silent axis.
 *
 * A Posting whose location could not be geocoded is *kept*, not dropped:
 * silently dropping it is how a User loses a role they wanted and never finds
 * out (#12). The Dashboard flags it as unresolved instead.
 *
 * The distance is a great-circle computation in SQL against the `geocodes`
 * cache, which `matchCriteria` has already filled for every surviving location.
 */
const withinCommuteRadius: FunnelStage = {
  name: "commute radius over the geocoded location",
  derived: true,
  narrow({ radiusMiles }, { home }) {
    if (radiusMiles == null || !home) return undefined;

    // The radius bites only on a Posting whose text places it onsite or hybrid
    // and does not also offer remote. Everything else — a remote role, or one
    // whose text names no location mode — is left alone, the same way the
    // Arrangement stage never excludes on a silent axis.
    const radiusDoesNotApply = or(
      not(arrayOverlaps(postings.arrangements, [...DISTANCE_ARRANGEMENTS])),
      arrayOverlaps(postings.arrangements, ["remote"] satisfies Arrangement[]),
    );

    // The only Postings the radius drops: those whose location the cache
    // resolved to a point that is too far. A location with no resolved point —
    // no cache row, or a negative result — matches nothing here and is kept, so
    // an unresolvable location is surfaced rather than lost.
    const outsideRadius = sql`
      exists (
        select 1 from ${geocodes} as g
        where g.location = ${postings.normalizedLocation}
          and g.latitude is not null
          and ${EARTH_RADIUS_MILES} * acos(least(1, greatest(-1,
            sin(radians(${home.latitude})) * sin(radians(g.latitude))
            + cos(radians(${home.latitude})) * cos(radians(g.latitude))
              * cos(radians(g.longitude) - radians(${home.longitude}))
          ))) > ${radiusMiles}
      )
    `;

    return or(radiusDoesNotApply, not(outsideRadius));
  },
};

/** The stages, in the order they run. */
const FUNNEL: FunnelStage[] = [
  titleAndKeywordMatch,
  minimumSalary,
  acceptedArrangements,
  unitedStatesOnly,
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

/** The normalized key for a User's home location, or null when they set none. */
function homeKeyOf(stated: CriteriaRow): string | null {
  if (stated.radiusMiles == null) return null;
  return normalizeLocation(stated.homeLocation);
}

/**
 * Fills the geocode cache with the locations a distance-bounded match run
 * needs — the survivors of the cheap stages, plus the User's home.
 *
 * Runs before the match transaction opens, on a plain handle: a warm-up run
 * makes one external call per uncached string, and none of that should hold the
 * User's `matches` rows locked. What it geocodes is read straight back out of
 * the cache inside the transaction (`resolveHomeCoordinate`, the distance
 * stage's subquery). A no-op when the User set no radius, or once the Corpus's
 * locations are all cached.
 *
 * The home location is geocoded on its own budget, and first: the distance
 * stage does not run at all without a home coordinate, so it must never be
 * crowded out of a bounded warm-up by the Posting locations. The rest are
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

  const homeKey = homeKeyOf(stated);
  if (!homeKey) return;

  await ensureGeocoded(db, [homeKey], 1);

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
    const key = normalizeLocation(row.location);
    if (key && key !== homeKey) keys.add(key);
  }

  await ensureGeocoded(db, [...keys]);
}

/**
 * The User's home coordinate, read from the cache `warmGeocodesForMatch` filled.
 *
 * Null when the User set no radius, or when their home location would not
 * geocode — the distance stage then does not run, because showing every role
 * beats hiding a commutable one.
 */
async function resolveHomeCoordinate(
  tx: Transaction,
  stated: CriteriaRow,
): Promise<Coordinate | null> {
  const homeKey = homeKeyOf(stated);
  return homeKey ? readGeocode(tx, homeKey) : null;
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
      home: await resolveHomeCoordinate(tx, stated),
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
