import { z } from "zod";
import { boardSubdomain, readBoardDocument } from "./adapter";
import {
  placeWithArrangement,
  statedSalary,
  toDate,
  type ArrangementLabel,
} from "./fields";
import type { SourcePosting } from "./types";

/**
 * The Recruitee Board adapter.
 *
 * Mostly European companies (`docs/research/job-sources.md`), and the only
 * Source that addresses a Board by subdomain rather than by path — which is why
 * the Slug is checked before it is put in a URL, not after.
 *
 * Source Key scope: Recruitee offer ids are numbers, which is the case #14
 * warns about — an id unique only within a Board would have two companies
 * overwriting each other on every Fetch, with no error to see it by. Checked on
 * 2026-08-29 across three live Boards: their ids interleave across one range
 * (312,680 to 2,721,844) with no repetition between them, which is one sequence
 * for the whole Source rather than one per Board. `(recruitee, id)` therefore
 * identifies a Posting on its own.
 */

const LABEL = "Recruitee";

function boardUrl(slug: string): string {
  return `https://${boardSubdomain(LABEL, slug)}.recruitee.com/api/offers/`;
}

const recruiteeOffer = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  company_name: z.string(),
  description: z.string(),
  careers_url: z.string(),
  // The requirements are a document of their own rather than part of the
  // description, and dropping them would lose the qualifications a keyword
  // match is most likely to be looking for.
  requirements: z.string().nullish(),
  location: z.string().nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  published_at: z.string().nullish(),
  salary: z
    .object({
      min: z.union([z.number(), z.string()]).nullish(),
      max: z.union([z.number(), z.string()]).nullish(),
      period: z.string().nullish(),
      currency: z.string().nullish(),
    })
    .nullish(),
});

const recruiteeBoard = z.object({
  offers: z.array(recruiteeOffer),
});

/**
 * The pay periods `statedSalary` understands, as Recruitee spells them.
 *
 * The spellings happen to coincide, so this reads as an identity map. It is a
 * whitelist rather than a translation: Recruitee also publishes `week` and
 * `day`, which nothing downstream can annualise, and they must fall through to
 * "no salary stated" rather than through a period nobody checked.
 */
const PERIOD: Record<string, "year" | "month" | "hour"> = {
  year: "year",
  month: "month",
  hour: "hour",
};

/** Fetches one Recruitee Board and returns its Postings. */
export async function fetchRecruiteeBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const board = await readBoardDocument({
    label: LABEL,
    slug,
    url: boardUrl(slug),
    schema: recruiteeBoard,
    signal,
  });

  return board.offers.map((offer) => ({
    source: "recruitee" as const,
    sourceId: String(offer.id),
    company: offer.company_name,
    title: offer.title,
    description: [offer.description, offer.requirements].filter(Boolean).join(""),
    // Recruitee states the workplace type as flags beside the place, so it is
    // written into the location where the Arrangement funnel reads it.
    location: placeWithArrangement(arrangementOf(offer), offer.location),
    // `careers_url` is the offer's page; `careers_apply_url` is the form on it.
    applyUrl: offer.careers_url,
    postedAt: toDate(offer.published_at),
    salary: statedSalary({
      currency: offer.salary?.currency,
      period: PERIOD[offer.salary?.period ?? ""] ?? null,
      min: offer.salary?.min,
      max: offer.salary?.max,
    }),
  }));
}

/** The Arrangement the offer's flags state, if they state one. */
function arrangementOf(
  offer: z.infer<typeof recruiteeOffer>,
): ArrangementLabel | null {
  if (offer.remote) return "Remote";
  if (offer.hybrid) return "Hybrid";
  return null;
}
