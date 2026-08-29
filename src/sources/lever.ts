import { z } from "zod";
import {
  companyFromSlug,
  placeNamed,
  placesNamed,
  readBoardDocument,
  statedSalary,
  toDate,
  type WorkplaceLabel,
} from "./adapter";
import type { SourcePosting } from "./types";

/**
 * The Lever Board adapter.
 *
 * Lever answers with a bare array of postings — no envelope — carrying full
 * descriptions in one unauthenticated request. See `docs/research/job-sources.md`.
 *
 * Source Key scope: Lever ids are UUIDs, so `(lever, id)` cannot collide
 * between Boards. Verified against the live API on 2026-08-29, which is the
 * check #14 asks for before an adapter is written: a Source numbering its jobs
 * only within a Board would have two companies overwriting each other on every
 * Fetch, silently.
 */

const LABEL = "Lever";

function boardUrl(slug: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(
    slug,
  )}?mode=json`;
}

/**
 * A Lever posting's description arrives in four pieces, which is why the
 * adapter assembles rather than copies: `description` is the opening, `lists`
 * are the titled bullet sections a company writes as Requirements or Benefits,
 * and `additional` is the closing boilerplate. Storing only `description`
 * would drop the qualifications — the part a keyword match is most likely to
 * be looking for.
 */
const leverPosting = z.object({
  id: z.string(),
  // Lever's name for the title. Nothing else on the posting carries it.
  text: z.string(),
  description: z.string(),
  hostedUrl: z.string(),
  lists: z
    .array(z.object({ text: z.string().nullish(), content: z.string().nullish() }))
    .nullish(),
  additional: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  workplaceType: z.string().nullish(),
  // Epoch milliseconds.
  createdAt: z.number().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});

const leverBoard = z.array(leverPosting);

/** How Lever spells the workplace types the location field carries. */
const WORKPLACE: Record<string, WorkplaceLabel> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

/** How Lever spells the pay periods `statedSalary` understands. */
const INTERVAL: Record<string, "year" | "month" | "hour"> = {
  "per-year-salary": "year",
  "per-month-salary": "month",
  "per-hour-wage": "hour",
};

/** Fetches one Lever Board and returns its Postings. */
export async function fetchLeverBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const board = await readBoardDocument({
    label: LABEL,
    slug,
    url: boardUrl(slug),
    schema: leverBoard,
    signal,
  });

  return board.map((posting) => ({
    source: "lever" as const,
    sourceId: posting.id,
    // Lever publishes no company name anywhere in the response, so the Slug is
    // all there is — see `companyFromSlug`.
    company: companyFromSlug(slug),
    title: posting.text,
    description: assembleDescription(posting),
    location: placeNamed(
      WORKPLACE[posting.workplaceType?.toLowerCase() ?? ""] ?? null,
      // `allLocations` is the full set and `location` the primary one; a
      // posting open in three cities says so.
      placesNamed(posting.categories?.allLocations ?? [posting.categories?.location]),
    ),
    // `hostedUrl` is the posting's page rather than `applyUrl`'s form, matching
    // what Greenhouse's `absolute_url` gives: a reader wants to see the role
    // before applying to it.
    applyUrl: posting.hostedUrl,
    postedAt: toDate(posting.createdAt),
    salary: statedSalary({
      currency: posting.salaryRange?.currency,
      period: INTERVAL[posting.salaryRange?.interval ?? ""] ?? null,
      min: posting.salaryRange?.min,
      max: posting.salaryRange?.max,
    }),
  }));
}

/** The opening, the titled list sections, and the closing, as one document. */
function assembleDescription(posting: z.infer<typeof leverPosting>): string {
  const sections = [
    posting.description,
    ...(posting.lists ?? []).map(
      // `content` is the `<li>` items without their list, and a section title
      // is the company's text — escaped, because this is the one place an
      // adapter builds HTML rather than passing it through.
      (list) =>
        `${list.text ? `<h3>${escapeHtml(list.text)}</h3>` : ""}<ul>${
          list.content ?? ""
        }</ul>`,
    ),
    posting.additional,
  ];

  return sections.filter(Boolean).join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
