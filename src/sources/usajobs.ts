import { z } from "zod";
import { readSourceDocument } from "./adapter";
import {
  everyPlace,
  placeWithArrangement,
  salaryPeriodFromWords,
  statedSalary,
  toDate,
} from "./fields";
import type { SourcePosting } from "./types";

/**
 * The USAJOBS adapter — every federal job matching a keyword.
 *
 * USAJOBS is an aggregator, not a Board: one authenticated endpoint spanning
 * every agency (ADR 0003, `docs/research/job-sources.md`). It is reached per
 * *keyword* rather than per company — the Slug is the keyword, and a Slug of
 * `all` asks for everything — because a bare query returns the whole federal
 * corpus and the curated set is meant to lean toward the roles being searched
 * for.
 *
 * The request needs a free API key and a contact address, both from the
 * environment. A Fetch with either missing throws rather than returning an
 * empty list, so #17 records a task failure a human can act on instead of the
 * Corpus quietly losing every federal Posting (ADR 0004 reads an empty
 * successful Fetch as expiry).
 *
 * Source Key scope: `MatchedObjectId` is USAJOBS's own control number for an
 * announcement, unique across the whole system, so `(usajobs, id)` identifies a
 * Posting even when two keyword Slugs both return it.
 *
 * Expiry: a keyword sweep is bounded (`MAX_PAGES`) and never guaranteed to be
 * the whole set, so absence is no evidence — `reconcileBoard` skips
 * absence-counting for this Source and `isExpired` reads `expiresAt`, which is
 * set from the announcement's own `ApplicationCloseDate`.
 */

const LABEL = "USAJOBS";
const SEARCH = "https://data.usajobs.gov/api/search";

/** The most USAJOBS will return in one page. */
const RESULTS_PER_PAGE = 500;

/**
 * A ceiling on pages per keyword, so a broad Slug like `all` cannot spend a
 * Worker's whole budget. Ten pages is five thousand announcements, well past
 * what any single keyword the curated set would use returns.
 */
const MAX_PAGES = 10;

/** How USAJOBS spells the pay periods, in its `RateIntervalCode`. */
const RATE_INTERVAL: Record<string, "year" | "month" | "hour"> = {
  PA: "year",
  PM: "month",
  PH: "hour",
};

/** One announcement, reduced to what the adapter depends on. */
const descriptor = z.object({
  PositionTitle: z.string(),
  PositionURI: z.string(),
  OrganizationName: z.string().nullish(),
  DepartmentName: z.string().nullish(),
  PositionLocationDisplay: z.string().nullish(),
  PositionLocation: z
    .array(z.object({ LocationName: z.string().nullish() }))
    .nullish(),
  RemoteIndicator: z.boolean().nullish(),
  UserArea: z
    .object({
      Details: z
        .object({ JobSummary: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  QualificationSummary: z.string().nullish(),
  PositionRemuneration: z
    .array(
      z.object({
        MinimumRange: z.union([z.string(), z.number()]).nullish(),
        MaximumRange: z.union([z.string(), z.number()]).nullish(),
        RateIntervalCode: z.string().nullish(),
        Description: z.string().nullish(),
      }),
    )
    .nullish(),
  PublicationStartDate: z.string().nullish(),
  ApplicationCloseDate: z.string().nullish(),
});

const searchResult = z.object({
  SearchResult: z.object({
    SearchResultItems: z.array(
      z.object({
        MatchedObjectId: z.string(),
        MatchedObjectDescriptor: descriptor,
      }),
    ),
    UserArea: z
      .object({ NumberOfPages: z.union([z.string(), z.number()]).nullish() })
      .nullish(),
  }),
});

function pageUrl(slug: string, page: number): string {
  const params = new URLSearchParams({
    ResultsPerPage: String(RESULTS_PER_PAGE),
    Page: String(page),
  });
  // `all` is the whole federal corpus; any other Slug is a keyword, written the
  // way a person would type it rather than as the hyphenated Slug.
  if (slug !== "all" && slug !== "*") {
    params.set("Keyword", slug.replace(/[-_]+/g, " ").trim());
  }
  return `${SEARCH}?${params.toString()}`;
}

/** Fetches every federal Posting for one keyword Slug. */
export async function fetchUsajobsBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const key = process.env.USAJOBS_API_KEY;
  const agent = process.env.USAJOBS_USER_AGENT;
  if (!key || !agent) {
    throw new Error(
      `${LABEL} needs USAJOBS_API_KEY and USAJOBS_USER_AGENT set — one or both is missing`,
    );
  }

  const headers = {
    Host: "data.usajobs.gov",
    "User-Agent": agent,
    "Authorization-Key": key,
  };

  const collected: SourcePosting[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { SearchResult } = await readSourceDocument({
      label: LABEL,
      subject: `page ${page} for "${slug}"`,
      url: pageUrl(slug, page),
      headers,
      schema: searchResult,
      signal,
    });

    for (const item of SearchResult.SearchResultItems) {
      collected.push(toPosting(item.MatchedObjectId, item.MatchedObjectDescriptor));
    }

    // `NumberOfPages` is the count USAJOBS itself reports for the query; an
    // empty page is the fallback for a response that omits it. Page fullness is
    // deliberately not the signal — the last page is short by definition, and a
    // Source that rounded its page size down once would have stopped a Fetch a
    // page early every night after.
    const pages = Number(SearchResult.UserArea?.NumberOfPages ?? 0);
    if (
      SearchResult.SearchResultItems.length === 0 ||
      (pages > 0 && page >= pages)
    ) {
      break;
    }
  }
  return collected;
}

function toPosting(
  id: string,
  job: z.infer<typeof descriptor>,
): SourcePosting {
  const pay = job.PositionRemuneration?.[0];

  return {
    source: "usajobs",
    sourceId: id,
    // Federal announcements always name an agency; the department is the
    // fallback for the rare one that leaves `OrganizationName` empty.
    company: job.OrganizationName || job.DepartmentName || "U.S. Federal Government",
    title: job.PositionTitle,
    description: [job.UserArea?.Details?.JobSummary, job.QualificationSummary]
      .filter(Boolean)
      .join("\n\n"),
    location: placeWithArrangement(
      job.RemoteIndicator ? "Remote" : null,
      everyPlace(
        job.PositionLocation?.map((place) => place.LocationName) ?? [
          job.PositionLocationDisplay,
        ],
      ),
    ),
    // `PositionURI` is the announcement page, matching what the ATS adapters
    // give: a reader wants to see the role before applying to it.
    applyUrl: job.PositionURI,
    postedAt: toDate(job.PublicationStartDate),
    // Federal announcements close on a stated date, which is the expiry signal
    // for a Source whose feed a Fetch never sees the whole of.
    expiresAt: toDate(job.ApplicationCloseDate),
    salary: statedSalary({
      // Federal pay is always in dollars.
      currency: "USD",
      period:
        salaryPeriodFromWords(pay?.Description) ??
        RATE_INTERVAL[pay?.RateIntervalCode ?? ""] ??
        null,
      min: pay?.MinimumRange ?? undefined,
      max: pay?.MaximumRange ?? undefined,
    }),
  };
}
