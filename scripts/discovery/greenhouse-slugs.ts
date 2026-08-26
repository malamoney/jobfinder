/**
 * Harvesting candidate Greenhouse Slugs from Common Crawl.
 *
 * No Source publishes a directory of Boards (ADR 0003), so the only way to
 * find Slugs is to look at what the open web has linked to. Common Crawl's
 * index answers "every URL I have seen under this host", and a Greenhouse
 * Board's public page carries its Slug in the first path segment.
 *
 * This lives outside `src/` because discovery is not part of the application:
 * it is run by hand, it writes nothing, and nothing scheduled calls it.
 */

/** The index shard to query. Common Crawl publishes a new one every month. */
const DEFAULT_INDEX = "CC-MAIN-2026-34";

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

/** Slugs as Greenhouse writes them: lowercase, no spaces, no punctuation. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!GREENHOUSE_HOSTS.includes(parsed.hostname.toLowerCase())) return null;

  const [first] = parsed.pathname.split("/").filter(Boolean);
  if (!first) return null;

  const candidate =
    first.toLowerCase() === "embed"
      ? parsed.searchParams.get("for")
      : decodeURIComponent(first);

  const slug = candidate?.toLowerCase().trim();
  if (!slug || NOT_A_SLUG.has(slug) || !SLUG_PATTERN.test(slug)) return null;

  return slug;
}

/**
 * Reads every distinct Slug out of a Common Crawl index response.
 *
 * The index answers in newline-delimited JSON, one object per crawled URL, and
 * a single Board contributes one line per Posting it has ever published — so the same
 * Slug arrives hundreds of times. A malformed line is skipped rather than
 * fatal: the response is a stream of independent records, and one bad row is
 * not a reason to lose the rest of a harvest.
 */
export function greenhouseSlugsFromIndex(body: string): string[] {
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

    const slug = greenhouseSlugFromUrl(url);
    if (slug) slugs.add(slug);
  }

  return [...slugs].sort();
}

/** How much of a shard to read. */
export type HarvestOptions = {
  /** Which monthly index to query. */
  index?: string;
  /**
   * How many pages to read per host, newest-sorted-first. Every page by
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
 * host with no coverage this month answers zero.
 */
async function countPages(pattern: string, options: HarvestOptions) {
  const url = `${indexUrl(pattern, options)}&showNumPages=true`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) return 0;

  const { pages } = (await response.json()) as { pages?: number };
  return typeof pages === "number" ? pages : 0;
}

/**
 * Asks Common Crawl what it has seen under the Greenhouse Board hosts, and
 * returns the distinct Slugs.
 *
 * Deliberately unguarded by a retry: this is a hand-run script, and a human
 * watching it fail can simply run it again.
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
 * Asks Common Crawl what it has seen under the Greenhouse Board hosts, and
 * returns the distinct Slugs.
 */
export async function harvestGreenhouseSlugs(
  options: HarvestOptions = {},
): Promise<Harvest> {
  const slugs = new Set<string>();
  let skippedPages = 0;

  for (const host of GREENHOUSE_HOSTS) {
    const pattern = `${host}/*`;
    const available = await countPages(pattern, options);
    const pages = Math.min(available, options.pages ?? available);

    if (pages === 0) {
      // The older host routinely has no coverage in a given month, and one
      // host answering with nothing is not the whole harvest failing.
      console.warn(`  ! ${host}: no pages in this index, skipping`);
      continue;
    }

    for (let page = 0; page < pages; page++) {
      const body = await readPage(pattern, options, page);
      if (body === null) {
        skippedPages++;
        console.warn(`  ! ${host} page ${page} could not be read`);
        continue;
      }

      for (const slug of greenhouseSlugsFromIndex(body)) slugs.add(slug);
    }

    console.log(`  ${host}: ${pages} page(s)`);
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
