import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { Writer } from "@/db";
import { postings } from "@/db/schema";
import { extractArrangements } from "@/postings/arrangement";
import { extractCountry } from "@/postings/country";
import { normalizeLocation } from "@/postings/location";
import {
  extractSalary,
  type ExtractedSalary,
  type SalaryPeriod,
} from "@/postings/salary";

/**
 * Extraction: deriving normalized salary, Arrangement, and a geocoding key from
 * a Posting's free text where the Source published nothing structured
 * (CONTEXT.md, "Extraction").
 *
 * Stage three of the matching funnel (#2). It runs over the Postings a User's
 * cheap stages let through, not the whole Corpus — extracting every ingested
 * Posting would be thousands a day, extracting only the survivors of keyword
 * matching is a few dozen (#11). The result is cached on the Posting
 * (`extracted_at`), so the next User whose Criteria surface the same Posting
 * pays nothing, and a re-Fetch clears it so the derived fields never outlive
 * the text they came from.
 *
 * Tested through the matching seam (`matching.test.ts`), not directly: the
 * pure normalizers it calls are the lower seam, and this is the orchestration
 * that joins them to the Corpus.
 */

/**
 * Extracts every Posting in `scope` that has not been through Extraction yet,
 * writing the derived fields back through `writer`.
 *
 * `scope` is a predicate over `postings` — Matching passes its cheap-stage
 * predicate, so the two never disagree about which Postings are survivors — and
 * `writer` is the caller's open transaction, so a Posting is never left half
 * extracted.
 */
export async function extractPostings(
  writer: Writer,
  scope: SQL,
): Promise<void> {
  const pending = await writer
    .select({
      id: postings.id,
      title: postings.title,
      location: postings.location,
      description: postings.description,
      salaryMin: postings.salaryMin,
      salaryMax: postings.salaryMax,
      salaryPeriod: postings.salaryPeriod,
    })
    .from(postings)
    // `country is null` alongside the usual `extracted_at is null` so a Posting
    // stored before country was classified (ADR 0009, now enforced on ingestion
    // by ADR 0010) is picked up on the next match run rather than only on its
    // next re-Fetch. Re-deriving the rest from the same text is idempotent, and
    // a salary already on record is kept.
    .where(and(scope, or(isNull(postings.extractedAt), isNull(postings.country))));
  if (pending.length === 0) return;

  const extractedAt = new Date();
  for (const posting of pending) {
    const text = [posting.title, posting.location, posting.description]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    // A salary the Source stated structurally wins over one recognised in prose
    // (#14). A Posting can only carry one at this point because it has not been
    // through Extraction — a re-Fetch clears `extracted_at` and rewrites the
    // salary columns from what the Source published in the same statement — so
    // a figure already here came from ingestion, not from an earlier run.
    const salary = salaryAlreadyOnRecord(posting) ?? extractSalary(text);

    await writer
      .update(postings)
      .set({
        salaryMin: salary ? Math.round(salary.min) : null,
        salaryMax: salary ? Math.round(salary.max) : null,
        salaryPeriod: salary?.period ?? null,
        arrangements: extractArrangements(text),
        // The geocode cache key (#12) and the country (ADR 0010), both from the
        // location string alone rather than the joined text — a place named in
        // the description is not where the role is.
        normalizedLocation: normalizeLocation(posting.location),
        country: extractCountry(posting.location),
        extractedAt,
      })
      .where(eq(postings.id, posting.id));
  }
}

/**
 * The salary a Posting arrived with, where its Source published one.
 *
 * Named for where it is read from rather than for who stated it, so it does not
 * read as the `statedSalary` in `@/sources/fields` — that one reads a Source's
 * own field, this one reads the columns ingestion wrote it into.
 */
function salaryAlreadyOnRecord(posting: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
}): ExtractedSalary | null {
  if (posting.salaryMin === null || posting.salaryPeriod === null) return null;
  return {
    min: posting.salaryMin,
    max: posting.salaryMax ?? posting.salaryMin,
    period: posting.salaryPeriod,
  };
}
