/**
 * Harvesting candidate Workable Slugs from Common Crawl.
 *
 * Workable is the Source with two Board URL shapes, and the crawl holds both:
 *
 * - the current one, `apply.workable.com/{slug}` — the Slug is the first path
 *   segment, and a posting hangs off it as `/{slug}/j/{shortcode}`;
 * - the older one, `{slug}.workable.com` — the Slug is the subdomain.
 *
 * Both resolve to the same account, which the adapter fetches by Slug against
 * `apply.workable.com/api/v1/widget/accounts/{slug}`, so a Slug from either
 * shape is a candidate.
 *
 * The plumbing lives in `./common-crawl`; this is only Workable's half.
 */
import { asSlug, firstPathSegment, parseUrl, type SlugSource } from "./common-crawl";

const APPLY_HOST = "apply.workable.com";
const WORKABLE_DOMAIN = ".workable.com";

/**
 * First path segments under `apply.workable.com` that are Workable's, not a
 * company's — `j` is the posting path, `api` the widget endpoint the adapter
 * itself calls.
 */
const NOT_A_SLUG = new Set(["j", "api", "spa", "backend", "super", "whoami"]);

/**
 * Subdomains of `workable.com` that are Workable's own — marketing, docs,
 * auth, the apply host itself. Anything else in that position is read as a
 * legacy Board subdomain and probed; a wrong guess is a 404 the probe drops.
 */
const NOT_A_BOARD_SUBDOMAIN = new Set([
  "www",
  "apply",
  "jobs",
  "resources",
  "help",
  "get",
  "go",
  "try",
  "hello",
  "info",
  "learn",
  "demo",
  "events",
  "blog",
  "support",
  "docs",
  "status",
  "api",
  "id",
  "partners",
  "partnerhelp",
  "jobseekers",
  "contact",
]);

/**
 * Reads the Board's Slug out of a crawled URL, or nothing if it is not a
 * Workable Board page — in either URL shape.
 */
export function workableSlugFromUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();

  if (host === APPLY_HOST) {
    return asSlug(firstPathSegment(parsed), NOT_A_SLUG);
  }

  if (host.endsWith(WORKABLE_DOMAIN)) {
    const label = host.slice(0, -WORKABLE_DOMAIN.length);
    if (label.includes(".") || NOT_A_BOARD_SUBDOMAIN.has(label)) return null;
    return asSlug(label);
  }

  return null;
}

/** Workable, as a harvest reads it. */
export const workable: SlugSource = {
  source: "workable",
  // One domain-wildcard pattern covers both shapes: `apply.workable.com`
  // itself and every `{slug}.workable.com`.
  patterns: [`*${WORKABLE_DOMAIN}/*`],
  slugFromUrl: workableSlugFromUrl,
};
