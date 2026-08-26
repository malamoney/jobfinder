import {
  readBoard,
  type BoardAddress,
  type BoardFetchOptions,
} from "./fetch-board";

/** What one candidate Slug turned out to be. */
export type BoardProbe = BoardAddress & {
  /**
   * How many Postings the Board returned. Zero with no error is a live Board
   * with nothing open, which is a real company between hires rather than a
   * dead Slug.
   */
  postings: number;
  /**
   * A few of the titles the Board is advertising.
   *
   * What a Board publishes matters more than how much of it there is: the
   * curated set is meant to lean towards the roles being searched for, and
   * until Criteria exist (#8) the only thing that can weigh that is a person
   * reading a sample. A count alone cannot tell a robotics company from a
   * staffing agency.
   */
  titles: string[];
  /** Why the candidate could not be read, and null if it could. */
  error: string | null;
};

/** Enough titles to tell what a company does, few enough to scan in a list. */
const TITLES_SHOWN = 5;

/**
 * Asks what a candidate Slug is, without letting its Postings into the Corpus.
 *
 * Discovery harvests far more Slugs than are worth sweeping — ADR 0003 puts
 * the full harvest at ninety-five thousand — so a probe is how the list gets
 * cut down to what a human should look at. The Corpus is shared by every User,
 * and a candidate nobody has promoted has not earned a place in it: this reads
 * a Board and reports on it, and writes nothing anywhere.
 *
 * Failure is an answer rather than an exception. A probe run covers hundreds
 * of candidates and roughly one in six is dead, so throwing would end the run
 * on the first bad Slug instead of reporting it as the finding it is.
 */
export async function probeBoard(
  candidate: BoardAddress,
  options: BoardFetchOptions = {},
): Promise<BoardProbe> {
  const { source, slug } = candidate;

  try {
    const fetched = await readBoard(candidate, options);
    return {
      source,
      slug,
      postings: fetched.length,
      titles: fetched.slice(0, TITLES_SHOWN).map((posting) => posting.title),
      error: null,
    };
  } catch (error) {
    return {
      source,
      slug,
      postings: 0,
      titles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
