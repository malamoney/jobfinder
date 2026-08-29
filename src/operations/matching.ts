import { and, eq, ilike, or, type Column, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  criteria,
  matches,
  postings,
  type CriteriaRow,
  type Posting,
} from "@/db/schema";

/**
 * The matching funnel: the ordered, deterministic stages that turn a User's
 * Criteria and the shared Corpus into their Matches.
 *
 * No LLM is involved. Every stage is a literal comparison a database can do, so
 * a Criteria change re-matches the entire Corpus with no time bound — there is
 * nothing to spend by recomputing everything (ADR 0001).
 *
 * The funnel is a list of stages run in order, each narrowing the Postings the
 * previous one let through. The parent spec names four: SQL over
 * source-structured fields; literal title and keyword text matching; Extraction
 * over the survivors; SQL over the extracted fields for salary, Arrangement, and
 * distance. Only the text stage does anything yet — no Criteria field this
 * ticket stores needs the others — so later tickets add entries to `FUNNEL`
 * rather than rewriting it (#11 salary and Arrangement, #12 distance).
 */

/** One stage of the funnel. */
type FunnelStage = {
  /** What the stage does, so `FUNNEL` reads as an ordered list. */
  name: string;
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

/** The stages, in the order they run. */
const FUNNEL: FunnelStage[] = [titleAndKeywordMatch];

/**
 * Every stage's predicate combined, or `undefined` when no stage narrowed
 * anything — which Matching reads as "select nothing", not "select the Corpus":
 * Criteria that pick out no Postings should surface none. Valid Criteria always
 * state a title, so this is a guard rather than a path taken.
 */
function funnelPredicate(stated: CriteriaRow): SQL | undefined {
  return and(...FUNNEL.map((stage) => stage.narrow(stated)));
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
 */
export async function matchCriteria(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(matches).where(eq(matches.userId, userId));

    const [stated] = await tx
      .select()
      .from(criteria)
      .where(eq(criteria.userId, userId));
    if (!stated) return;

    const predicate = funnelPredicate(stated);
    if (!predicate) return;

    const hits = await tx.select().from(postings).where(predicate);
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
