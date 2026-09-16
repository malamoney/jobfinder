/**
 * The keyword list as the Criteria form holds it: one list, each entry in one
 * of the two modes a keyword has (#135, ADR 0017).
 *
 * A User is shown a single list they toggle between widening and required
 * (spec, story 7) rather than two boxes to sort words into up front. The
 * schema stores the two modes as two arrays, so the list is split on the way
 * to a save and joined on the way back. Nothing here reaches the database or
 * `next`; it is the form's own bookkeeping, kept as functions so it can be
 * tested without rendering.
 */

export type KeywordEntry = {
  term: string;
  /**
   * Whether a Posting must contain this word to be shown. `false` is a
   * widening keyword — what every keyword was before #135, and what a new one
   * is until the User says otherwise.
   */
  required: boolean;
};

/** The two arrays `@/criteria/schema` takes a keyword statement as. */
type SplitKeywords = {
  keywords: string[];
  requiredKeywords: string[];
};

/** Sorts the toggled list into the two arrays a save posts. */
export function splitKeywords(entries: readonly KeywordEntry[]): SplitKeywords {
  return {
    keywords: entries.filter((e) => !e.required).map((e) => e.term),
    requiredKeywords: entries.filter((e) => e.required).map((e) => e.term),
  };
}

/**
 * Rebuilds the toggled list from the two arrays a save answered with, or the
 * stored ones the page opened on.
 *
 * Required first: the gate is the stronger statement and the one a User
 * reopening the page most wants to confirm is still there. It is also the
 * order a Match's `matched_keywords` lists them in.
 */
export function joinKeywords(
  keywords: readonly string[],
  requiredKeywords: readonly string[],
): KeywordEntry[] {
  return [
    ...requiredKeywords.map((term) => ({ term, required: true })),
    ...keywords.map((term) => ({ term, required: false })),
  ];
}

/**
 * Whether two terms are the same keyword to the funnel, which matches them
 * case-insensitively (`src/operations/matching.ts`).
 *
 * Only adding needs this. Toggling and removing act on a chip that is
 * already in the list, and name it exactly — the list holds one casing of
 * a word (this check, and the schema's own dedupe, see to that), so exact
 * is enough, and it is the right reading should a stored row from before
 * the dedupe ever carry two casings: each chip then acts on itself alone.
 */
function sameTerm(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The list with a typed keyword added as widening, the default mode — or
 * unchanged if it was blank or already there.
 *
 * "Already there" is read the way matching reads it, so `typescript` cannot
 * be added beside `TypeScript`. Two casings of one word in different modes
 * would be a keyword that both must and need not be present — story 12 — and
 * the schema's backstop would settle that by keeping the required copy,
 * which is not something a User should find out after a save.
 */
export function withKeyword(
  entries: readonly KeywordEntry[],
  typed: string,
): KeywordEntry[] {
  const term = typed.trim();
  if (!term) return [...entries];
  if (entries.some((e) => sameTerm(e.term, term))) return [...entries];
  return [...entries, { term, required: false }];
}

/** The list with one keyword flipped to the other mode, in its same place. */
export function withRequiredToggled(
  entries: readonly KeywordEntry[],
  term: string,
): KeywordEntry[] {
  return entries.map((e) =>
    e.term === term ? { ...e, required: !e.required } : e,
  );
}

/** The list with one keyword gone, whichever mode it was in. */
export function withoutKeyword(
  entries: readonly KeywordEntry[],
  term: string,
): KeywordEntry[] {
  return entries.filter((e) => e.term !== term);
}
