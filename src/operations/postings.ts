import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type Posting } from "@/db/schema";

/**
 * Reads the whole Corpus, oldest Fetch first.
 *
 * Postings collected by one Fetch all share a `first_seen_at`, so the Source
 * Key breaks the tie: ordering on the row id instead would be ordering on a
 * random UUID, and the order would differ between two identical runs.
 *
 * The Dashboard reads a User's Matches instead (#9); this exists so a Fetch's
 * effect can be observed from outside without a test reaching for the
 * database itself.
 */
export async function listPostings(): Promise<Posting[]> {
  return getDb()
    .select()
    .from(postings)
    .orderBy(
      asc(postings.firstSeenAt),
      asc(postings.source),
      asc(postings.sourceId),
    );
}
