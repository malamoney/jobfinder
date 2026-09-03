import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Writer } from "@/db";
import { postings } from "@/db/schema";
import { extractArrangements } from "@/postings/arrangement";
import { extractCountry } from "@/postings/country";
import { normalizeLocations } from "@/postings/location";
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
 * that joins them to the Corpus. The one exception is `renormalizeLocations`,
 * a catch-up pass no match run reaches (`extraction.test.ts`).
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
        // The geocode cache keys (#12) and the country (ADR 0010), both from the
        // location string alone rather than the joined text — a place named in
        // the description is not where the role is. One key per place the text
        // names (#113), so a role offered in two cities is measured against
        // both rather than against the two strung together.
        normalizedLocations: normalizeLocations(posting.location),
        country: extractCountry(posting.location),
        extractedAt,
      })
      .where(eq(postings.id, posting.id));
  }
}

/**
 * Re-derives every Posting's list of places from the location text the Corpus
 * already holds, and returns how many rows changed (#113).
 *
 * Extraction writes those keys once and then nothing revisits them: a Posting a
 * Fetch still returns re-derives them the next night, because a re-Fetch clears
 * the derived fields — but an Expired one, or one nothing re-collected yet,
 * keeps whatever the reading of the day gave it. So a change to how a location
 * is read (splitting `San Francisco Bay Area, CA / Seattle, WA` into two places
 * instead of one unplaceable string) does not reach the rows already stored.
 * This pass does, without a re-Fetch: it is the catch-up `pnpm warm-geocodes`
 * runs before it fills the cache, so the places it geocodes are the ones the
 * Corpus will actually be measured on.
 *
 * The work is pure string handling, so the whole Corpus is cheap to walk in one
 * pass; only the rows whose list actually changed are written, batched by the
 * list they move to.
 */
export async function renormalizeLocations(writer: Writer): Promise<number> {
  const rows = await writer
    .select({
      id: postings.id,
      location: postings.location,
      normalizedLocations: postings.normalizedLocations,
    })
    .from(postings);

  // Grouped by the list a row moves to, so every Posting landing on the same
  // places is one statement — `boston, ma` is thousands of rows and one update.
  const moves = new Map<string, { places: string[]; ids: string[] }>();
  for (const row of rows) {
    const places = normalizeLocations(row.location);
    if (samePlaces(places, row.normalizedLocations)) continue;

    // A separator no normalized place can contain, so two different lists
    // cannot collide on one group.
    const group = places.join("\u0000");
    const move = moves.get(group);
    if (move) move.ids.push(row.id);
    else moves.set(group, { places, ids: [row.id] });
  }

  let moved = 0;
  for (const { places, ids } of moves.values()) {
    await writer
      .update(postings)
      .set({ normalizedLocations: places })
      .where(inArray(postings.id, ids));
    moved += ids.length;
  }

  return moved;
}

/** Whether two lists name the same places in the same order. */
function samePlaces(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((place, i) => place === right[i])
  );
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
