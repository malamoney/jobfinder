/**
 * Harvesting candidate Recruitee Slugs from Common Crawl.
 *
 * Recruitee is the one Source that addresses a Board by subdomain:
 * `{slug}.recruitee.com`. So the Slug is read out of the hostname, not the
 * path, and it has to be a DNS label — the same guard `boardSubdomain` puts on
 * it in the adapter, applied here so a harvest never offers up a "Slug" that
 * could not be placed in a hostname.
 *
 * The plumbing lives in `./common-crawl`; this is only Recruitee's half.
 */
import { isHostLabel } from "@/sources/adapter";
import { asSlug, parseUrl, type SlugSource } from "./common-crawl";

const RECRUITEE_DOMAIN = ".recruitee.com";

/**
 * Subdomains of `recruitee.com` that are Recruitee's own — the marketing site,
 * docs, the API host — rather than a customer's Board.
 */
const NOT_A_BOARD_SUBDOMAIN = new Set([
  "www",
  "support",
  "docs",
  "blog",
  "api",
  "status",
  "help",
  "app",
  "careers",
  "jobs",
  "developers",
]);

/**
 * Reads the Board's Slug out of a crawled URL, or nothing if it is not a
 * Recruitee Board page. `recruitee.com` on its own — no subdomain — is the
 * marketing site and reads as nothing.
 */
export function recruiteeSlugFromUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(RECRUITEE_DOMAIN)) return null;

  const label = host.slice(0, -RECRUITEE_DOMAIN.length);
  if (label.includes(".") || NOT_A_BOARD_SUBDOMAIN.has(label)) return null;
  if (!isHostLabel(label)) return null;

  return asSlug(label);
}

/** Recruitee, as a harvest reads it. */
export const recruitee: SlugSource = {
  source: "recruitee",
  patterns: [`*${RECRUITEE_DOMAIN}/*`],
  slugFromUrl: recruiteeSlugFromUrl,
};
