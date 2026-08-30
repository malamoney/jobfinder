/**
 * Harvesting candidate Ashby Slugs from Common Crawl.
 *
 * An Ashby Board's public page is `jobs.ashbyhq.com/{slug}` — the Slug is the
 * first path segment, and a posting hangs off it as `/{slug}/{uuid}`. Ashby
 * also serves an embedded form and an application-builder path; both live
 * under reserved first segments rather than a company's.
 *
 * The plumbing lives in `./common-crawl`; this is only Ashby's half.
 */
import {
  asSlug,
  firstPathSegment,
  parseUrl,
  type SlugSource,
} from "./common-crawl";

/** The host an Ashby Board is served from. */
const ASHBY_HOST = "jobs.ashbyhq.com";

/**
 * First path segments that name a piece of Ashby rather than a company.
 *
 * `b` is the application-builder path and `meeting` the scheduler — both are
 * `Disallow`ed in Ashby's own robots.txt. `embed` is the widget form.
 */
const NOT_A_SLUG = new Set([
  "embed",
  "api",
  "posting-api",
  "job-board",
  "b",
  "meeting",
]);

/**
 * Reads the Board's Slug out of a crawled URL, or nothing if it is not an
 * Ashby Board page.
 */
export function ashbySlugFromUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  if (parsed.hostname.toLowerCase() !== ASHBY_HOST) return null;

  return asSlug(firstPathSegment(parsed), NOT_A_SLUG);
}

/** Ashby, as a harvest reads it. */
export const ashby: SlugSource = {
  source: "ashby",
  patterns: [`${ASHBY_HOST}/*`],
  slugFromUrl: ashbySlugFromUrl,
};
