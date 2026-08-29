import { z } from "zod";
import { readSourceDocument } from "./adapter";
import {
  everyPlace,
  feedCloseDate,
  oneSourcePostingPerId,
  placeWithArrangement,
  salaryPeriodFromWords,
  statedSalary,
  toDate,
} from "./fields";
import type { SourcePosting } from "./types";

/**
 * The Himalayas adapter — a feed of remote jobs across many employers.
 *
 * Himalayas is an aggregator, not a Board (ADR 0003,
 * `docs/research/job-sources.md`): one unauthenticated feed, ordered
 * newest-first, paged by an opaque cursor. There is nothing to address per
 * company, so the Slug only names the feed; `remote` is the conventional one.
 *
 * The feed is ~95,000 jobs and a Fetch pulls only the newest `MAX_PAGES`
 * of it — enough to catch everything posted since the last nightly sweep, far
 * short of the whole. Absence from a run is therefore no evidence a role is
 * gone: `reconcileBoard` skips absence-counting for this Source, and `isExpired`
 * reads `expiresAt`, set from each job's own `expiryDate`.
 *
 * Source Key scope: `guid` is the job's canonical Himalayas URL, unique across
 * the feed, so `(himalayas, guid)` identifies a Posting on its own.
 */

const LABEL = "Himalayas";
const FEED = "https://himalayas.app/jobs/api";

/** The feed's largest page. */
const PAGE_SIZE = 100;

/**
 * How many pages of the newest jobs one Fetch pulls. Twenty pages is the two
 * thousand most recent postings — comfortably more than a day's worth, and
 * bounded so the feed's size cannot spend a Worker's whole budget.
 */
const MAX_PAGES = 20;

/** One job as the feed publishes it, reduced to what the adapter depends on. */
const himalayasJob = z.object({
  // The canonical Himalayas URL for the job; doubles as its stable id.
  guid: z.string(),
  title: z.string(),
  companyName: z.string(),
  description: z.string(),
  applicationLink: z.string(),
  // Epoch seconds.
  pubDate: z.number().nullish(),
  expiryDate: z.number().nullish(),
  locationRestrictions: z.array(z.string()).nullish(),
  minSalary: z.number().nullish(),
  maxSalary: z.number().nullish(),
  salaryPeriod: z.string().nullish(),
  currency: z.string().nullish(),
});

const feedPage = z.object({
  jobs: z.array(himalayasJob),
  // Absent or null on the last page. Present as a token to pass back as
  // `?cursor=` otherwise — the feed's preferred paging, which also dedupes
  // across pages as new jobs arrive at the top.
  nextCursor: z.string().nullish(),
});

function pageUrl(cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return `${FEED}?${params.toString()}`;
}

/** Fetches the newest slice of the Himalayas feed. */
export async function fetchHimalayasBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const collected: SourcePosting[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result: z.infer<typeof feedPage> = await readSourceDocument({
      label: LABEL,
      subject:
        page === 0 ? `feed "${slug}"` : `feed "${slug}" page ${page + 1}`,
      url: pageUrl(cursor),
      schema: feedPage,
      signal,
    });

    for (const job of result.jobs) collected.push(toPosting(job));

    if (!result.nextCursor || result.jobs.length === 0) break;
    cursor = result.nextCursor;
  }
  // Cursor paging is meant to dedupe across pages, but a job promoted to the
  // top of the feed mid-walk can still arrive twice; the Corpus upsert would
  // fail the whole Fetch on the repeated Source Key.
  return oneSourcePostingPerId(collected);
}

function toPosting(job: z.infer<typeof himalayasJob>): SourcePosting {
  return {
    source: "himalayas",
    sourceId: job.guid,
    company: job.companyName,
    title: job.title,
    description: job.description,
    // Every Himalayas role is remote; `locationRestrictions` narrows *where*
    // remote — `["United States"]`, `["United States", "Canada"]` — and the
    // matching funnel reads the Arrangement back out of this string (#11).
    location: placeWithArrangement(
      "Remote",
      everyPlace(job.locationRestrictions ?? []),
    ),
    applyUrl: job.applicationLink,
    postedAt: job.pubDate == null ? null : toDate(job.pubDate * 1000),
    // The feed publishes each job's own close date; the fallback covers a job
    // that arrives without one, so a role never sits live in the Corpus forever
    // (an aggregator Posting never expires by absence — ADR 0007).
    expiresAt: feedCloseDate(
      job.expiryDate == null ? null : toDate(job.expiryDate * 1000),
    ),
    salary: statedSalary({
      currency: job.currency,
      period: salaryPeriodFromWords(job.salaryPeriod),
      min: job.minSalary ?? undefined,
      max: job.maxSalary ?? undefined,
    }),
  };
}
