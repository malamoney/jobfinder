import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { postings, type Posting } from "@/db/schema";

/**
 * Reads the whole Corpus, in the order it was collected.
 *
 * The Dashboard reads a User's Matches instead (#9); this exists so a Fetch's
 * effect can be observed from outside without a test reaching for the
 * database itself.
 */
export async function listPostings(): Promise<Posting[]> {
  return getDb()
    .select()
    .from(postings)
    .orderBy(asc(postings.firstSeenAt), asc(postings.id));
}
