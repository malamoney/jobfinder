import type { SourceName } from "@/db/schema";
import type { ExtractedSalary } from "@/postings/salary";

/**
 * A Posting as one Source published it, normalized to the shape the Corpus
 * stores.
 *
 * Every adapter returns these, which is what lets one upsert serve all of
 * them. It carries no identity of its own: the Source Key on it is what the
 * upsert matches against.
 *
 * Which Board these came from is deliberately absent. An adapter is told the
 * Board to fetch and reports back only what the Source published about the
 * jobs on it; the Fetch already knows which Board it asked, and it is the
 * Fetch that holds the reference the Corpus stores.
 */
export type SourcePosting = {
  source: SourceName;
  sourceId: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
  applyUrl: string;
  postedAt: Date | null;
  /**
   * The close date the Source published for this opening, or null where it
   * published none.
   *
   * Set only by the aggregator adapters (#15). Their feed spans far more
   * employers than one Fetch can pull, so a Posting the run did not return is
   * not evidence it is gone — `reconcileBoard` skips absence-counting for them
   * and `isExpired` reads this date instead. An ATS adapter omits it: one
   * request is its Board's whole state, so absence is the signal (ADR 0004).
   */
  expiresAt?: Date | null;
  /**
   * The salary the Source published in a field of its own, or null where it
   * published none — which is the common case, and the one Extraction exists
   * for.
   *
   * Set only from structured compensation, never from prose: Ashby, Lever, and
   * Recruitee each publish a compensation object (#14), and a figure a company
   * entered into a field marked "salary" is worth more than one recognised in a
   * description. `extractPostings` reads a Posting that arrived with this as
   * already answered on salary and leaves it alone.
   */
  salary: ExtractedSalary | null;
};
