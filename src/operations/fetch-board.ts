import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type SourceName } from "@/db/schema";
import { fetchGreenhouseBoard } from "@/sources/greenhouse";
import type { SourcePosting } from "@/sources/types";

/** One company's listings within a Source, addressed by its Slug. */
export type Board = {
  source: SourceName;
  slug: string;
};

/** The adapter each Source is reached through. */
const ADAPTERS: Record<SourceName, (slug: string) => Promise<SourcePosting[]>> =
  {
    greenhouse: fetchGreenhouseBoard,
  };

/**
 * Fetches one Board and writes its Postings into the Corpus.
 *
 * Throws if the Board could not be fetched or its response could not be
 * understood, and writes nothing in that case. The distinction between a Board
 * that failed and a Board that returned nothing is what expiry rests on
 * (#7): only a Fetch that returned is evidence a Posting is gone.
 */
export async function fetchBoard(board: Board): Promise<void> {
  const fetched = await ADAPTERS[board.source](board.slug);
  await storePostings(fetched);
}

/**
 * Upserts Postings on their Source Key, so a Posting already in the Corpus is
 * updated rather than duplicated.
 *
 * Every field the Source publishes is overwritten — a company that edited a
 * description means the old one is wrong — while `first_seen_at` keeps the
 * date the Corpus first met the Posting.
 */
async function storePostings(fetched: SourcePosting[]): Promise<void> {
  if (fetched.length === 0) return;

  await getDb()
    .insert(postings)
    .values(fetched)
    .onConflictDoUpdate({
      target: [postings.source, postings.sourceId],
      set: {
        boardSlug: sql`excluded.board_slug`,
        company: sql`excluded.company`,
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        location: sql`excluded.location`,
        applyUrl: sql`excluded.apply_url`,
        postedAt: sql`excluded.posted_at`,
        lastSeenAt: sql`now()`,
      },
    });
}
