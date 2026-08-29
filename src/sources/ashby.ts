import { z } from "zod";
import {
  companyFromSlug,
  placeNamed,
  readBoardDocument,
  statedSalary,
  toDate,
  type WorkplaceLabel,
} from "./adapter";
import type { SourcePosting } from "./types";

/**
 * The Ashby Board adapter.
 *
 * The one Source that publishes pay as data rather than as prose, which is why
 * #14 singles it out: where Ashby states a salary, that figure is used and the
 * regex Extraction that reads pay out of descriptions never runs for the
 * Posting.
 *
 * Source Key scope: Ashby ids are UUIDs, so `(ashby, id)` cannot collide
 * between Boards. Verified against the live API on 2026-08-29.
 */

const LABEL = "Ashby";

/**
 * `includeCompensation=true` is not decoration: without it the `compensation`
 * field is absent from every job — verified on 2026-08-29 — and the Corpus
 * would quietly fall back to reading pay out of prose for the one Source that
 * does not need it.
 */
function boardUrl(slug: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    slug,
  )}?includeCompensation=true`;
}

/**
 * One pay component of a job's compensation.
 *
 * A job's compensation is a list of these — salary, equity, bonus, commission
 * — and only the one marked `Salary` is pay this can compare against a floor.
 */
const ashbyComponent = z.object({
  compensationType: z.string().nullish(),
  interval: z.string().nullish(),
  currencyCode: z.string().nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
});

const ashbyJob = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  descriptionHtml: z.string(),
  location: z.string().nullish(),
  workplaceType: z.string().nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  compensation: z
    .object({ summaryComponents: z.array(ashbyComponent).nullish() })
    .nullish(),
});

const ashbyBoard = z.object({
  jobs: z.array(ashbyJob),
});

/** How Ashby spells the workplace types the location field carries. */
const WORKPLACE: Record<string, WorkplaceLabel> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

/** How Ashby spells the pay periods `statedSalary` understands. */
const INTERVAL: Record<string, "year" | "month" | "hour"> = {
  "1 YEAR": "year",
  "1 MONTH": "month",
  "1 HOUR": "hour",
};

/** Fetches one Ashby Board and returns its Postings. */
export async function fetchAshbyBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const board = await readBoardDocument({
    label: LABEL,
    slug,
    url: boardUrl(slug),
    schema: ashbyBoard,
    signal,
  });

  return (
    board.jobs
      // A job Ashby marks unlisted is one the company took off its own board,
      // so it is not an opening a User could apply to. Only an explicit `false`
      // excludes: a Source that stops sending the field must not empty a Board,
      // which ADR 0004 would read as every Posting on it having expired.
      .filter((job) => job.isListed !== false)
      .map((job) => ({
        source: "ashby" as const,
        sourceId: job.id,
        // Ashby publishes no company name anywhere in the response, so the Slug
        // is all there is — see `companyFromSlug`.
        company: companyFromSlug(slug),
        title: job.title,
        description: job.descriptionHtml,
        location: placeNamed(
          WORKPLACE[job.workplaceType?.toLowerCase() ?? ""] ?? null,
          job.location,
        ),
        // The posting's page rather than `applyUrl`'s form, matching what
        // Greenhouse's `absolute_url` gives.
        applyUrl: job.jobUrl,
        postedAt: toDate(job.publishedAt),
        salary: salaryOf(job),
      }))
  );
}

/** The salary component of a job's compensation, if it published one. */
function salaryOf(job: z.infer<typeof ashbyJob>): SourcePosting["salary"] {
  const salary = job.compensation?.summaryComponents?.find(
    (component) => component.compensationType === "Salary",
  );
  if (!salary) return null;

  return statedSalary({
    currency: salary.currencyCode,
    period: INTERVAL[salary.interval ?? ""] ?? null,
    min: salary.minValue,
    max: salary.maxValue,
  });
}
