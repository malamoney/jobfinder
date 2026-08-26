import type { SourceName } from "@/db/schema";

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
};
