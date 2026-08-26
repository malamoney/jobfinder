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
 * a single Board contributes one line per job it has ever posted — so the same
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
   * How many crawled URLs to read per host.
   *
   * Bounded at the source rather than after the fact, because a whole shard
   * under these hosts runs to hundreds of megabytes. A Board contributes one
   * record per job it has ever posted, so distinct Slugs come back far slower
   * than records do — this trades harvest depth for a run that finishes.
   */
  records?: number;
};

const DEFAULT_RECORDS = 20_000;

/** Where Common Crawl answers index queries for one monthly shard. */
export function indexUrl(
  pattern: string,
  { index = DEFAULT_INDEX, records = DEFAULT_RECORDS }: HarvestOptions = {},
): string {
  return `https://index.commoncrawl.org/${index}-index?url=${encodeURIComponent(
    pattern,
  )}&output=json&limit=${records}`;
}

/**
 * Asks Common Crawl what it has seen under the Greenhouse Board hosts, and
 * returns the distinct Slugs.
 *
 * Deliberately unguarded by a retry: this is a hand-run script, and a human
 * watching it fail can simply run it again.
 */
export async function harvestGreenhouseSlugs(
  options: HarvestOptions = {},
): Promise<string[]> {
  const slugs = new Set<string>();

  for (const host of GREENHOUSE_HOSTS) {
    const url = indexUrl(`${host}/*`, options);
    const response = await fetch(url, {
      // Long, because the index is answering with every URL under a host, but
      // still bounded: a hand-run script that hangs is one nobody re-runs.
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      // One host failing is not the whole harvest failing — the older host
      // routinely has no shard coverage in a given month.
      console.warn(
        `  ! ${host}: ${response.status} ${response.statusText}, skipping`,
      );
      continue;
    }

    for (const slug of greenhouseSlugsFromIndex(await response.text())) {
      slugs.add(slug);
    }
  }

  return [...slugs].sort();
}
