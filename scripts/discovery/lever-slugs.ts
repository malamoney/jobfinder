/**
 * Harvesting candidate Lever Slugs from Common Crawl.
 *
 * A Lever Board's public page is `jobs.lever.co/{slug}` — the Slug is the first
 * path segment, the same position Greenhouse uses.
 *
 * Only that one host is swept. Lever also runs `jobs.eu.lever.co` for EU
 * tenants, and in this month's crawl that host has by far the wider coverage —
 * `jobs.lever.co` itself `Disallow`s CCBot in robots.txt, so Common Crawl has
 * almost nothing under it — but a Board on the EU host is served by
 * `api.eu.lever.co`, which `fetchLeverBoard` does not call. Harvesting those
 * Slugs would only fill the seed with Boards every sweep fails on. Widening the
 * adapter to the EU API, and this harvester to the EU host with it, is a
 * follow-up.
 *
 * The plumbing lives in `./common-crawl`; this is only Lever's half.
 */
import {
  asSlug,
  firstPathSegment,
  parseUrl,
  type SlugSource,
} from "./common-crawl";

/** The host a Lever Board this adapter can fetch is served from. */
const LEVER_HOSTS = ["jobs.lever.co"];

/**
 * First path segments that name a piece of Lever rather than a company.
 *
 * The public board has no path prefix, so the list is short: `embed` is the
 * widget form a company gets when it puts its Board in its own careers page.
 */
const NOT_A_SLUG = new Set(["embed"]);

/**
 * Reads the Board's Slug out of a crawled URL, or nothing if it is not a Lever
 * Board page.
 */
export function leverSlugFromUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  if (!LEVER_HOSTS.includes(parsed.hostname.toLowerCase())) return null;

  return asSlug(firstPathSegment(parsed), NOT_A_SLUG);
}

/** Lever, as a harvest reads it. */
export const lever: SlugSource = {
  source: "lever",
  patterns: LEVER_HOSTS.map((host) => `${host}/*`),
  slugFromUrl: leverSlugFromUrl,
};
