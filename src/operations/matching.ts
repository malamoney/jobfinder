import {
  and,
  arrayOverlaps,
  eq,
  ilike,
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
import type { Arrangement } from "@/criteria/schema";
import { WORKING_HOURS_PER_YEAR } from "@/postings/salary";
import { extractPostings } from "./extraction";

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
 * never the whole Corpus (#11). Distance (#12) adds another derived stage.
 */

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
  narrow(stated: CriteriaRow): SQL | undefined;
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

/** The Arrangement values that describe where the work happens. */
const LOCATION_MODES = [
  "remote",
  "onsite",
  "hybrid",
] as const satisfies readonly Arrangement[];
/** The Arrangement values that describe the employment type. */
const EMPLOYMENT_TYPES = [
  "full-time",
  "part-time",
] as const satisfies readonly Arrangement[];

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
    const perAxis = [LOCATION_MODES, EMPLOYMENT_TYPES]
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

/** The stages, in the order they run. */
const FUNNEL: FunnelStage[] = [
  titleAndKeywordMatch,
  minimumSalary,
  acceptedArrangements,
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
function combine(stages: FunnelStage[], stated: CriteriaRow): SQL | undefined {
  return and(...stages.map((stage) => stage.narrow(stated)));
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
 * a Dashboard "Run Now" (#48) will call it directly.
 *
 * One transaction, and the Criteria are read inside it, so the rebuild cannot
 * race a concurrent save and land against a statement that no longer exists.
 * Postings collected before this Criteria statement existed are matched like any
 * other — the Corpus has no notion of which Fetch brought a Posting in.
 *
 * The run is two queries around Extraction: the cheap stages select the
 * survivors, Extraction fills the derived fields for those survivors only, and
 * the full funnel then selects the Matches. Re-running the cheap stages in the
 * second query is deliberate — they are free, and it avoids carrying a list of
 * thousands of ids between the two.
 */
export async function matchCriteria(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(matches).where(eq(matches.userId, userId));

    const [stated] = await tx
      .select()
      .from(criteria)
      .where(eq(criteria.userId, userId));
    if (!stated) return;

    const cheapStages = FUNNEL.filter((stage) => !stage.derived);
    const cheap = combine(cheapStages, stated);
    if (!cheap) return;

    // Stage three: Extraction over the survivors of the cheap stages only
    // (#11). Cached on the Posting, so a survivor a previous match already
    // extracted costs nothing here.
    await extractPostings(tx, cheap);

    const full = combine(FUNNEL, stated);
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
