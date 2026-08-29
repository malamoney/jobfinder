import { z } from "zod";
import { isHostLabel, readSourceDocument } from "./adapter";
import { arrangementLabel, everyPlace, placeWithArrangement, toDate } from "./fields";
import type { SourcePosting } from "./types";
import { WORKDAY_TENANTS, type WorkdayTenant } from "./workday-tenants";

/**
 * The Workday adapter — a hand-picked enterprise tenant, fetched as the slice
 * of itself that matches a keyword.
 *
 * Workday is a deliberate extension to the ingestion spine, not a member of it
 * (ADR 0003). It is structurally unlike every other Source in three ways, and
 * this adapter sits beside `readBoardDocument` rather than using it because of
 * them:
 *
 * - **It pages a POST.** The job list is `POST .../jobs` with a
 *   `{ limit, offset, searchText }` body and a `total` in the response.
 * - **A description is a second request.** The list carries only a title and
 *   an `externalPath`; the description comes from `GET .../{externalPath}`,
 *   one request per job. That is what makes Workday ~100× the per-Board
 *   request cost of any other Source.
 * - **The tenant cannot be derived from the Slug.** The Slug names the tenant,
 *   but the `wd{N}` shard, the site name, the company, and the search all come
 *   from `WORKDAY_TENANTS` (`./workday-tenants`), maintained by hand. A Slug
 *   not configured there cannot be fetched.
 *
 * Cost is bounded by `MAX_JOBS_PER_TENANT` and made observable two ways: a
 * tenant whose search matches more than the ceiling fails the Fetch loudly
 * (#17 records it, nothing is written), and on the success path the request
 * cost is `postings + ceil(postings / PAGE_SIZE)` — so a tenant's standing
 * Posting count in the Corpus is proportional to what it costs to fetch.
 *
 * Expiry: Workday is an `absence` Source like the ATS Boards. One Fetch pulls
 * the tenant's whole `searchText` slice, so a job that drops out of it is
 * counted absent and moves toward Expired (ADR 0004). This is why a tenant's
 * `search` is fixed config: change it and the slice changes under the expiry
 * counter.
 *
 * Source Key scope: a Workday requisition id is unique only within a tenant,
 * so the Source Key is tenant-prefixed — `{slug}:{externalPath}` — to stay
 * unique across the whole Source without a schema change (`postings.board_id`
 * would be the alternative).
 */

const LABEL = "Workday";

/** Jobs per list page. Workday's list endpoint caps `limit` at 20. */
const PAGE_SIZE = 20;

/**
 * The most jobs one tenant's Fetch will pull descriptions for.
 *
 * This is the number that bounds a tenant's request cost: a Fetch at the
 * ceiling is roughly `MAX_JOBS_PER_TENANT / PAGE_SIZE` list requests plus
 * `MAX_JOBS_PER_TENANT` detail requests. A hundred tenants at this ceiling is
 * the "tens of thousands of Greenhouse Boards" of request volume ADR 0003's
 * research anticipated.
 *
 * A tenant whose search matches more than this fails the Fetch (see the module
 * note). Raising it, or narrowing a tenant's `search` in `./workday-tenants`,
 * is a deliberate edit — not something that happens because a company grew.
 */
export const MAX_JOBS_PER_TENANT = 600;

/**
 * A page ceiling one over what the job budget needs, so a list that never
 * agrees with its own `total` is a loud failure rather than a silent prefix.
 */
const MAX_LIST_PAGES = Math.ceil(MAX_JOBS_PER_TENANT / PAGE_SIZE) + 1;

/** A career-site name — an opaque path segment, so `/`, `.`, `?`, `#` are out. */
const SITE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** One entry in the job list, reduced to what the adapter depends on. */
const jobListing = z.object({
  externalPath: z.string(),
});

const jobsPage = z.object({
  total: z.number(),
  // Absent rather than empty on a page past the end, on some tenants.
  jobPostings: z.array(jobListing).nullish(),
});

/** One job's detail document, reduced to what the adapter depends on. */
const jobDetail = z.object({
  jobPostingInfo: z.object({
    title: z.string(),
    jobDescription: z.string(),
    location: z.string().nullish(),
    additionalLocations: z.array(z.string()).nullish(),
    remoteType: z.string().nullish(),
    startDate: z.string().nullish(),
    externalUrl: z.string().nullish(),
  }),
});

/** A configured tenant with the Slug that named it, threaded together. */
type ResolvedTenant = WorkdayTenant & { slug: string };

function origin(tenant: ResolvedTenant): string {
  return `https://${tenant.slug}.${tenant.shard}.myworkdayjobs.com`;
}

function cxsPath(tenant: ResolvedTenant): string {
  return `${origin(tenant)}/wday/cxs/${tenant.slug}/${tenant.site}`;
}

/** The public job page, for the tenant whose detail omits `externalUrl`. */
function jobPageUrl(tenant: ResolvedTenant, externalPath: string): string {
  return `${origin(tenant)}/en-US/${tenant.site}${externalPath}`;
}

/**
 * The tenant a Slug names, or a Board-phrased error.
 *
 * Every failure is before a request is built: a Slug with no configuration
 * (the "no harvesting path" — a harvested Workday host is inert until a person
 * fills in `./workday-tenants`), and a configuration that would not make a
 * safe URL. The Slug and shard land in the hostname and the site lands in the
 * path, and `encodeURIComponent` is not applied to any of them — the same
 * exposure `boardSubdomain` guards for Recruitee, widened to the two fields
 * Workday adds.
 */
function resolveWorkdayTenant(slug: string): ResolvedTenant {
  const config = WORKDAY_TENANTS[slug];
  if (!config) {
    throw new Error(
      `${LABEL} Board "${slug}" is not a configured tenant — its shard, site, and search are set by hand in workday-tenants.ts`,
    );
  }
  if (!isHostLabel(slug) || !isHostLabel(config.shard)) {
    throw new Error(
      `${LABEL} Board "${slug}" has a Slug or shard that is not safe in a hostname (shard "${config.shard}")`,
    );
  }
  if (!SITE_SEGMENT.test(config.site)) {
    throw new Error(
      `${LABEL} Board "${slug}" has a site that is not safe in a request path: "${config.site}"`,
    );
  }
  return { ...config, slug };
}

/** Fetches one Workday tenant's `searchText` slice and returns its Postings. */
export async function fetchWorkdayBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const tenant = resolveWorkdayTenant(slug);
  const paths = await listJobPaths(tenant, signal);

  const postings: SourcePosting[] = [];
  for (const externalPath of paths) {
    postings.push(await fetchJob(tenant, externalPath, signal));
  }
  return postings;
}

/**
 * Walks the tenant's paged job list and returns each job's `externalPath`,
 * de-duplicated.
 *
 * Offset paging re-lists a job that shifted across a page boundary while the
 * loop was walking it, and fetching its detail twice would hand the Corpus
 * upsert the same Source Key twice and fail the whole Fetch — so the paths are
 * de-duplicated here, before any detail request is spent on them.
 *
 * The walk ends when a page comes back short — that, not the reported `total`,
 * is the end of the list, because a `total` that under-reports would otherwise
 * stop the walk early and leave a partial list looking like the tenant's whole
 * state (ADR 0004). `total` is only ever read to refuse a tenant over budget.
 *
 * Three things end the walk as a failure rather than a result: a `total` over
 * budget, a first page that reports matches but returns none, and a list whose
 * own length runs past the budget or past `MAX_LIST_PAGES` — a list that never
 * short-pages is one whose `total` cannot be trusted at all.
 */
async function listJobPaths(
  tenant: ResolvedTenant,
  signal: AbortSignal,
): Promise<string[]> {
  const paths = new Set<string>();

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const result = await readSourceDocument({
      label: LABEL,
      subject: `Board "${tenant.slug}" jobs ${offset}–${offset + PAGE_SIZE}`,
      url: `${cxsPath(tenant)}/jobs`,
      method: "POST",
      body: {
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset,
        searchText: tenant.search,
      },
      schema: jobsPage,
      signal,
    });

    const batch = result.jobPostings ?? [];
    if (page === 0 && result.total > 0 && batch.length === 0) {
      throw new Error(
        `${LABEL} Board "${tenant.slug}" reports ${result.total} matching jobs but its list came back empty — the response shape may have changed`,
      );
    }
    for (const listing of batch) {
      paths.add(usablePath(tenant, listing.externalPath));
    }

    if (Math.max(result.total, paths.size) > MAX_JOBS_PER_TENANT) {
      throw new Error(
        `${LABEL} Board "${tenant.slug}" has ${Math.max(
          result.total,
          paths.size,
        )} jobs for search "${tenant.search}", above the ${MAX_JOBS_PER_TENANT}-job budget — narrow the tenant's search or raise MAX_JOBS_PER_TENANT`,
      );
    }

    if (batch.length < PAGE_SIZE) return [...paths];
  }

  throw new Error(
    `${LABEL} Board "${tenant.slug}" did not finish paging within ${MAX_LIST_PAGES} pages — its list never came back short, so its total is not to be trusted`,
  );
}

/**
 * A job's `externalPath`, checked before it is spliced into a URL and a Source
 * Key. It comes from Workday's own list response, but it becomes the path of
 * the detail request and the tail of the Source Key, so a value carrying `..`
 * or a scheme is refused rather than trusted.
 */
function usablePath(tenant: ResolvedTenant, externalPath: string): string {
  if (!externalPath.startsWith("/") || /\.\.|:\/\//.test(externalPath)) {
    throw new Error(
      `${LABEL} Board "${tenant.slug}" returned a job path it cannot use: "${externalPath}"`,
    );
  }
  return externalPath;
}

/** Fetches one job's detail document and turns it into a Posting. */
async function fetchJob(
  tenant: ResolvedTenant,
  externalPath: string,
  signal: AbortSignal,
): Promise<SourcePosting> {
  const { jobPostingInfo: info } = await readSourceDocument({
    label: LABEL,
    subject: `Board "${tenant.slug}" job ${externalPath}`,
    url: `${cxsPath(tenant)}${externalPath}`,
    schema: jobDetail,
    signal,
  });

  return {
    source: "workday",
    // Tenant-prefixed: a requisition id is unique only within a tenant.
    sourceId: `${tenant.slug}:${externalPath}`,
    company: tenant.company,
    title: info.title,
    description: info.jobDescription,
    // Workday states the workplace type as a field of its own (`remoteType`:
    // `Remote`, `Hybrid`, `On-site`), which the matching funnel would never
    // see unless it is written into the location string it reads (#11) — the
    // same thing every other adapter does with `placeWithArrangement`.
    location: placeWithArrangement(
      arrangementLabel(info.remoteType),
      everyPlace([info.location, ...(info.additionalLocations ?? [])]),
    ),
    applyUrl: info.externalUrl ?? jobPageUrl(tenant, externalPath),
    // `startDate` is the ISO date the posting opened. `postedOn` is a phrase
    // (`Posted 5 Days Ago`) and is deliberately not a fallback.
    postedAt: toDate(info.startDate),
    // Workday publishes pay only in the description, so every Workday salary is
    // Extraction's to find.
    salary: null,
  };
}
