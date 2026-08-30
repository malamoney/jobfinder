/**
 * Harvesting candidate Slugs from Common Crawl, for any ATS Source.
 *
 * No Source publishes a directory of Boards (ADR 0003), so the only way to
 * find Slugs is to look at what the open web has linked to. Common Crawl's
 * index answers "every URL I have seen under this host", and a Board's public
 * page carries its Slug — in the first path segment for most Sources, in the
 * hostname for the one that addresses a Board by subdomain (Recruitee).
 *
 * The plumbing here is Source-agnostic: it queries the index, reads its pages,
 * and hands each crawled URL to the Source's own `slugFromUrl`. A Source is a
 * `SlugSource` — the patterns to query and the rule for reading a Slug out of
 * a URL — and lives in its own `{source}-slugs.ts` beside this file.
 *
 * This lives outside `src/` because discovery is not part of the application:
 * it is run by hand, it writes nothing, and nothing scheduled calls it.
 */
import type { SourceName } from "@/db/schema";

/** The index shard to query. Common Crawl publishes a new one every month. */
const DEFAULT_INDEX = "CC-MAIN-2026-34";

/**
 * One ATS Source, as a harvest reads it: where its Boards were linked from,
 * and how to read a Slug out of one of those links.
 */
export type SlugSource = {
  /** The Source's name, as a log line and the `--source` flag spell it. */
  source: SourceName;
  /**
   * The Common Crawl URL patterns whose crawled links carry this Source's
   * Slugs — one per Board host. A leading `*.` matches every subdomain, which
   * is how a Source whose Slug *is* a subdomain (Recruitee) is swept, and how
   * a Source with a second regional host (Lever's EU board host) is covered.
   */
  patterns: readonly string[];
  /**
   * Reads the Board's Slug out of a crawled URL, or nothing if it is not a
   * Board page for this Source. Pure, and the one part of a harvest worth
   * testing on its own — everything else here is a network call.
   */
  slugFromUrl: (url: string) => string | null;
};

/**
 * Slugs as an ATS writes them: lowercase, a leading alphanumeric, then word
 * characters and hyphens. The shared shape every Source's `slugFromUrl` holds
 * its candidate to before returning it.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const NOTHING: ReadonlySet<string> = new Set();

/**
 * Normalises a candidate Slug, and rejects the ones that are not Slugs.
 *
 * Every `slugFromUrl` ends here: lowercase and trim, drop anything that is a
 * piece of the ATS rather than a company (`notASlug`), and drop anything
 * carrying characters an ATS Slug does not. A naive read of a URL's first path
 * segment turns up `embed`, `robots.txt`, `job_board` and more, and one of
 * those harvested as a Slug becomes thousands of probes against a 404.
 */
export function asSlug(
  candidate: string | null | undefined,
  notASlug: ReadonlySet<string> = NOTHING,
): string | null {
  const slug = candidate?.toLowerCase().trim();
  if (!slug || notASlug.has(slug) || !SLUG_PATTERN.test(slug)) return null;
  return slug;
}

/**
 * The first non-empty path segment of a URL, decoded, or null if there is none
 * — or if it is not decodable. A crawled URL with a stray `%` in the path
 * (`/foo%/`) parses fine but throws from `decodeURIComponent`, and one such row
 * must not abort a harvest that has already read thousands of pages.
 */
export function firstPathSegment(parsed: URL): string | null {
  const [first] = parsed.pathname.split("/").filter(Boolean);
  if (!first) return null;
  try {
    return decodeURIComponent(first);
  } catch {
    return null;
  }
}

/** Parses a URL, or nothing if the string is not one. */
export function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Reads every distinct Slug out of a Common Crawl index response.
 *
 * The index answers in newline-delimited JSON, one object per crawled URL, and
 * a single Board contributes one line per Posting it has ever published — so
 * the same Slug arrives hundreds of times. A malformed line is skipped rather
 * than fatal: the response is a stream of independent records, and one bad row
 * is not a reason to lose the rest of a harvest.
 */
export function slugsFromIndex(source: SlugSource, body: string): string[] {
  const slugs = new Set<string>();

  for (const line of body.split("\n")) {
    if (!line.trim()) continue;

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const url = (record as { url?: unknown }).url;
    if (typeof url !== "string") continue;

    const slug = source.slugFromUrl(url);
    if (slug) slugs.add(slug);
  }

  return [...slugs].sort();
}

/** How much of a shard to read. */
export type HarvestOptions = {
  /** Which monthly index to query. */
  index?: string;
  /**
   * How many pages to read per pattern, newest-sorted-first. Every page by
   * default, which is the only setting that harvests without bias.
   *
   * Capping this is for a quick look, and it costs representativeness: the
   * index answers in SURT order, so the first page is the front of the
   * alphabet and nothing else. Reading two of five pages does not give you a
   * fifth of the Boards — it gives you every Board beginning with "a" and no
   * others.
   */
  pages?: number;
};

/** Where Common Crawl answers index queries for one monthly shard. */
export function indexUrl(
  pattern: string,
  { index = DEFAULT_INDEX }: HarvestOptions = {},
  page?: number,
): string {
  const url = new URL(`https://index.commoncrawl.org/${index}-index`);
  url.searchParams.set("url", pattern);
  url.searchParams.set("output", "json");
  if (page !== undefined) url.searchParams.set("page", String(page));
  return url.toString();
}

/**
 * Asks how many pages the index holds for a pattern.
 *
 * The index paginates rather than accepting an offset, so this is the only way
 * to read a whole host: ask how many pages there are, then ask for each. A
 * pattern with no coverage this month answers zero.
 */
async function countPages(pattern: string, options: HarvestOptions) {
  const url = `${indexUrl(pattern, options)}&showNumPages=true`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return 0;

  const { pages } = (await response.json()) as { pages?: number };
  return typeof pages === "number" ? pages : 0;
}

/**
 * What a harvest hands back.
 *
 * Deliberately unguarded by anything more than a per-page retry: this is a
 * hand-run script, and a human watching it fail can simply run it again.
 */
export type Harvest = {
  slugs: string[];
  /**
   * Pages the index would not serve, after retries.
   *
   * Worth reporting rather than swallowing. Pages are alphabetical ranges, so
   * a page lost is not a smaller sample of the same population — it is every
   * Board in one stretch of the alphabet missing entirely, and a run that says
   * nothing about it looks exactly like a clean one.
   */
  skippedPages: number;
};

/** How many times a page is asked for before it is given up on. */
const ATTEMPTS = 3;

/**
 * Asks Common Crawl what it has seen under a Source's Board hosts, and returns
 * the distinct Slugs.
 */
export async function harvestSlugs(
  source: SlugSource,
  options: HarvestOptions = {},
): Promise<Harvest> {
  const slugs = new Set<string>();
  let skippedPages = 0;

  for (const pattern of source.patterns) {
    const available = await countPages(pattern, options);
    const pages = Math.min(available, options.pages ?? available);

    if (pages === 0) {
      // A Source's older or regional host routinely has no coverage in a given
      // month, and one pattern answering with nothing is not the whole harvest
      // failing.
      console.warn(`  ! ${pattern}: no pages in this index, skipping`);
      continue;
    }

    for (let page = 0; page < pages; page++) {
      const body = await readPage(pattern, options, page);
      if (body === null) {
        skippedPages++;
        console.warn(`  ! ${pattern} page ${page} could not be read`);
        continue;
      }

      for (const slug of slugsFromIndex(source, body)) slugs.add(slug);
    }

    console.log(`  ${pattern}: ${pages} page(s)`);
  }

  return { slugs: [...slugs].sort(), skippedPages };
}

/**
 * Reads one page, retrying before giving up.
 *
 * The index answers 502 fairly often under these patterns and then serves the
 * same page happily a moment later, so a single failure is not evidence the
 * page is unavailable — and giving up on it costs a whole slice of the
 * alphabet.
 */
async function readPage(
  pattern: string,
  options: HarvestOptions,
  page: number,
): Promise<string | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(indexUrl(pattern, options, page), {
        // Long, because a page is tens of thousands of records, but still
        // bounded: a hand-run script that hangs is one nobody re-runs.
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return await response.text();
    } catch {
      // A dropped connection is the same problem as a 502 here, and gets the
      // same answer: ask again.
    }

    if (attempt < ATTEMPTS) {
      await new Promise((wake) => setTimeout(wake, attempt * 2_000));
    }
  }

  return null;
}
