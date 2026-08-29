import { z } from "zod";
import { readBoardDocument } from "./adapter";
import { toDate } from "./fields";
import type { SourcePosting } from "./types";

/**
 * The Greenhouse Board adapter.
 *
 * Greenhouse returns every job on a Board, with full descriptions, in a single
 * unauthenticated request, which is why it is the Source the ingestion path
 * was proved with. See `docs/research/job-sources.md`.
 *
 * Tested through `fetchBoard` in `src/operations` rather than directly, so one
 * assertion covers the adapter, the Source Key upsert, and persistence.
 *
 * Source Key scope: Greenhouse job ids are unique across the whole Source, not
 * per Board — confirmed against the live API on 2026-08-25 — so `(greenhouse,
 * id)` identifies a Posting on its own.
 */

const LABEL = "Greenhouse";

function boardUrl(slug: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    slug,
  )}/jobs?content=true`;
}

/**
 * What the adapter depends on, and nothing more.
 *
 * Unknown fields are stripped and missing ones are fatal; `readBoardDocument`
 * holds both halves of that rule and the reasoning behind them.
 */
const greenhouseJob = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  company_name: z.string(),
  absolute_url: z.string(),
  content: z.string(),
  location: z.object({ name: z.string() }).nullish(),
  first_published: z.string().nullish(),
});

const greenhouseBoard = z.object({
  jobs: z.array(greenhouseJob),
});

/** Fetches one Greenhouse Board and returns its Postings. */
export async function fetchGreenhouseBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const board = await readBoardDocument({
    label: LABEL,
    slug,
    url: boardUrl(slug),
    schema: greenhouseBoard,
    signal,
  });

  return board.jobs.map((job) => ({
    source: "greenhouse" as const,
    sourceId: String(job.id),
    company: job.company_name,
    title: job.title,
    description: decodeHtmlEntities(job.content),
    location: job.location?.name ?? null,
    // `updated_at` is deliberately not a fallback: it is when the company last
    // edited the job, and showing that as the posted date would age a Posting
    // wrongly on the Dashboard. No published date is null, not a guess.
    postedAt: toDate(job.first_published),
    applyUrl: job.absolute_url,
    // Greenhouse publishes pay only in the description, so every Greenhouse
    // salary is Extraction's to find.
    salary: null,
  }));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Undoes Greenhouse's escaping of the description it returns.
 *
 * `content` arrives HTML-escaped — `&lt;p&gt;` for a paragraph tag — so
 * storing it verbatim would put the markup in front of the reader as text.
 *
 * One pass, never two: the escaped payload holds entities that belong to the
 * company's own HTML (`&amp;nbsp;` unescapes to `&nbsp;`, which is correct and
 * final), and a second pass would eat those too. Entities this does not
 * recognise are left alone rather than guessed at.
 */
function decodeHtmlEntities(html: string): string {
  return html.replace(
    /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const codePoint = entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        // Anything outside the Unicode range is not a character reference the
        // company meant to write, so it stays as it came.
        return Number.isNaN(codePoint) || codePoint > 0x10ffff
          ? match
          : String.fromCodePoint(codePoint);
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}
