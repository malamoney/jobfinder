/**
 * Harvesting candidate Greenhouse Slugs from Common Crawl.
 *
 * A Greenhouse Board's public page carries its Slug in the first path segment,
 * and the embedded-widget form names the company in a query parameter. The
 * plumbing — querying the index, reading its pages, retrying — is
 * Source-agnostic and lives in `./common-crawl`; this file is only Greenhouse's
 * half: which hosts to sweep and how to read a Slug out of one of their URLs.
 */
import {
  asSlug,
  firstPathSegment,
  harvestSlugs,
  parseUrl,
  slugsFromIndex,
  type Harvest,
  type HarvestOptions,
  type SlugSource,
} from "./common-crawl";

export type { Harvest, HarvestOptions } from "./common-crawl";

/**
 * The hosts a Greenhouse Board is served from.
 *
 * `job-boards` is the current one; `boards` is the older host, which is still
 * what most of the crawled links point at.
 */
const GREENHOUSE_HOSTS = ["job-boards.greenhouse.io", "boards.greenhouse.io"];

/**
 * Path segments that look like a Slug but name a piece of Greenhouse instead.
 *
 * `embed` is the one that matters: the embedded board widget puts the company
 * in a query parameter rather than the path, so a naive read of the first
 * segment would harvest thousands of Boards all called "embed".
 */
const NOT_A_SLUG = new Set(["embed", "jobs", "job", "boards", "v1", "assets"]);

/**
 * Reads the Board's Slug out of a crawled URL, or nothing if it is not a
 * Greenhouse Board page.
 *
 * Both URL shapes are handled, because the crawl holds both: the path form
 * `job-boards.greenhouse.io/acme/jobs/123`, and the embed form
 * `boards.greenhouse.io/embed/job_board?for=acme`, which is what a company
 * gets when it puts its Board inside its own careers page.
 */
export function greenhouseSlugFromUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  if (!GREENHOUSE_HOSTS.includes(parsed.hostname.toLowerCase())) return null;

  const first = firstPathSegment(parsed);
  if (!first) return null;

  const candidate =
    first.toLowerCase() === "embed"
      ? parsed.searchParams.get("for")
      : first;

  return asSlug(candidate, NOT_A_SLUG);
}

/** Greenhouse, as a harvest reads it. */
export const greenhouse: SlugSource = {
  source: "greenhouse",
  patterns: GREENHOUSE_HOSTS.map((host) => `${host}/*`),
  slugFromUrl: greenhouseSlugFromUrl,
};

/** Reads every distinct Greenhouse Slug out of a Common Crawl index response. */
export function greenhouseSlugsFromIndex(body: string): string[] {
  return slugsFromIndex(greenhouse, body);
}

/**
 * Asks Common Crawl what it has seen under the Greenhouse Board hosts, and
 * returns the distinct Slugs.
 */
export function harvestGreenhouseSlugs(
  options: HarvestOptions = {},
): Promise<Harvest> {
  return harvestSlugs(greenhouse, options);
}
