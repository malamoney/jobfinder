import type { SourceName } from "@/db/schema";

/**
 * A Posting as one Source published it, normalized to the shape the Corpus
 * stores.
 *
 * Every adapter returns these, which is what lets one upsert serve all of
 * them. It carries no identity of its own: the Source Key on it is what the
 * upsert matches against.
 */
export type SourcePosting = {
  source: SourceName;
  sourceId: string;
  boardSlug: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
  applyUrl: string;
  postedAt: Date | null;
};
