import { z } from "zod";
import { readBoardDocument } from "./adapter";
import { everyPlace, placeWithArrangement, toDate } from "./fields";
import type { SourcePosting } from "./types";

/**
 * The Workable Board adapter.
 *
 * Source Key scope: a Workable job is addressed by its `shortcode`, which is
 * the whole of its public URL (`apply.workable.com/j/{shortcode}`) and so is
 * unique across the Source rather than within a Board. Verified against the
 * live API on 2026-08-29.
 *
 * The quirk that shapes this adapter: **Workable returns one entry per job per
 * location**, so a role open in two cities arrives twice under one shortcode,
 * differing only in `city` and `state`. Verified live on 2026-08-29 against a
 * Board advertising eight entries for seven jobs. Left alone that is not a
 * cosmetic duplicate: the Corpus upserts on the Source Key, and Postgres
 * refuses an insert that would touch one row twice, so a single such job would
 * fail the Board's whole Fetch every night. They are collapsed here, where the
 * fact belongs to the Source.
 */

const LABEL = "Workable";

/**
 * `details=true` is what makes the response carry descriptions; without it the
 * widget returns titles and locations only (`docs/research/job-sources.md`).
 */
function boardUrl(slug: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(
    slug,
  )}?details=true`;
}

const workableJob = z.object({
  shortcode: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  published_on: z.string().nullish(),
  created_at: z.string().nullish(),
});

/**
 * The envelope carries the company name — the account's own — which is the
 * only place on a Workable response it appears.
 */
const workableBoard = z.object({
  name: z.string(),
  jobs: z.array(workableJob),
});

/** Fetches one Workable Board and returns its Postings. */
export async function fetchWorkableBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const board = await readBoardDocument({
    label: LABEL,
    slug,
    url: boardUrl(slug),
    schema: workableBoard,
    signal,
  });

  return collapseByShortcode(board.jobs).map(({ job, places }) => ({
    source: "workable" as const,
    sourceId: job.shortcode,
    company: board.name,
    title: job.title,
    description: job.description,
    location: placeWithArrangement(
      // Workable states remote work as a flag rather than in the location, and
      // an adapter that dropped it would publish a remote role no Arrangement
      // filter can see as remote.
      job.telecommuting ? "Remote" : null,
      everyPlace(places),
    ),
    applyUrl: job.url,
    // `published_on` is when the job went live; `created_at` is when it was
    // drafted, and is only a fallback because a published job is what this is.
    postedAt: toDate(job.published_on ?? job.created_at),
    // Workable's widget publishes no compensation field, so every Workable
    // salary is Extraction's to find.
    salary: null,
  }));
}

type WorkableJob = z.infer<typeof workableJob>;

/** One job, with every place the Board listed it under. */
type CollapsedJob = { job: WorkableJob; places: string[] };

/**
 * One Posting per shortcode, keeping every location the entries named.
 *
 * The first entry stands for the job — the entries are identical but for their
 * place — and the places are gathered so the Posting names all of them.
 */
function collapseByShortcode(jobs: WorkableJob[]): CollapsedJob[] {
  const collapsed = new Map<string, CollapsedJob>();

  for (const job of jobs) {
    const seen = collapsed.get(job.shortcode);
    const place = placeOf(job);

    if (!seen) {
      collapsed.set(job.shortcode, { job, places: place ? [place] : [] });
    } else if (place) {
      seen.places.push(place);
    }
  }

  return [...collapsed.values()];
}

/** The place one entry names, as the Source's three fields spell it. */
function placeOf(job: WorkableJob): string | null {
  const place = [job.city, job.state, job.country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  return place || null;
}
