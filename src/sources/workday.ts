import { z } from "zod";
import { readSourceDocument } from "./adapter";
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
 * - **The tenant cannot be derived from the Slug.** The `wd{N}` shard, the
 *   site name, the company, and the search all come from `WORKDAY_TENANTS`
 *   (`./workday-tenants`), maintained by hand. A Slug not configured there
 *   cannot be fetched.
 *
 * Cost is bounded by `MAX_JOBS_PER_TENANT` and made observable by failing
 * loudly at it: a tenant whose search matches more than the ceiling throws
 * rather than fetching a silent prefix, so #17 records the failure and the
 * ceiling is raised — or the tenant's search narrowed — as a decision someone
 * made rather than a number that crept up.
 *
 * Expiry: Workday is an `absence` Source like the ATS Boards. One Fetch pulls
 * the tenant's whole `searchText` slice, so a job that drops out of it is
 * counted absent and moves toward Expired (ADR 0004). This is why a tenant's
 * `search` is fixed config: change it and the slice changes under the expiry
 * counter.
 *
 * Source Key scope: a Workday requisition id is unique only within a tenant,
 * so the Source Key is tenant-prefixed — `{tenant}:{externalPath}` — to stay
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

/** A hard ceiling on list requests, in case `total` cannot be trusted. */
const MAX_LIST_PAGES = Math.ceil(MAX_JOBS_PER_TENANT / PAGE_SIZE) + 1;

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

function origin(tenant: WorkdayTenant): string {
  return `https://${tenant.tenant}.${tenant.shard}.myworkdayjobs.com`;
}

function cxsPath(tenant: WorkdayTenant): string {
  return `${origin(tenant)}/wday/cxs/${tenant.tenant}/${tenant.site}`;
}

/** The public job page, for the tenant whose detail omits `externalUrl`. */
function jobPageUrl(tenant: WorkdayTenant, externalPath: string): string {
  return `${origin(tenant)}/en-US/${tenant.site}${externalPath}`;
}

const HOST_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

/**
 * The tenant a Slug names, or a Board-phrased error.
 *
 * Two failures, both before a request is built: a Slug with no configuration
 * (the "no harvesting path" — a harvested Workday host is inert until a person
 * fills in `./workday-tenants`), and a configuration whose tenant or shard is
 * not a DNS label. The shard and tenant land in the hostname, and
 * `encodeURIComponent` does not contain a `.` or `/` there — the same exposure
 * `boardSubdomain` guards for Recruitee, with the shard added.
 */
function resolveWorkdayTenant(slug: string): WorkdayTenant {
  const tenant = WORKDAY_TENANTS[slug];
  if (!tenant) {
    throw new Error(
      `${LABEL} Board "${slug}" is not a configured tenant — its shard, site, and search are set by hand in workday-tenants.ts`,
    );
  }
  for (const part of ["tenant", "shard"] as const) {
    if (!HOST_LABEL.test(tenant[part])) {
      throw new Error(
        `${LABEL} Board "${slug}" has a ${part} that is not safe in a hostname: "${tenant[part]}"`,
      );
    }
  }
  return tenant;
}

/** Fetches one Workday tenant's `searchText` slice and returns its Postings. */
export async function fetchWorkdayBoard(
  slug: string,
  signal: AbortSignal,
): Promise<SourcePosting[]> {
  const tenant = resolveWorkdayTenant(slug);
  const paths = await listJobPaths(tenant, slug, signal);

  const postings: SourcePosting[] = [];
  for (const externalPath of paths) {
    postings.push(await fetchJob(tenant, slug, externalPath, signal));
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
 */
async function listJobPaths(
  tenant: WorkdayTenant,
  slug: string,
  signal: AbortSignal,
): Promise<string[]> {
  const paths = new Set<string>();

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const result = await readSourceDocument({
      label: LABEL,
      subject: `Board "${slug}" jobs ${offset}–${offset + PAGE_SIZE}`,
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

    if (page === 0 && result.total > MAX_JOBS_PER_TENANT) {
      throw new Error(
        `${LABEL} Board "${slug}" matches ${result.total} jobs for search "${tenant.search}", above the ${MAX_JOBS_PER_TENANT}-job budget — narrow the tenant's search or raise MAX_JOBS_PER_TENANT`,
      );
    }

    const batch = result.jobPostings ?? [];
    for (const listing of batch) paths.add(listing.externalPath);

    if (
      batch.length < PAGE_SIZE ||
      paths.size >= result.total ||
      // A backstop for a `total` the page count never catches up to.
      paths.size >= MAX_JOBS_PER_TENANT
    ) {
      break;
    }
  }
  return [...paths];
}

/** Fetches one job's detail document and turns it into a Posting. */
async function fetchJob(
  tenant: WorkdayTenant,
  slug: string,
  externalPath: string,
  signal: AbortSignal,
): Promise<SourcePosting> {
  const { jobPostingInfo: info } = await readSourceDocument({
    label: LABEL,
    subject: `Board "${slug}" job ${externalPath}`,
    url: `${cxsPath(tenant)}${externalPath}`,
    schema: jobDetail,
    signal,
  });

  return {
    source: "workday",
    // Tenant-prefixed: a requisition id is unique only within a tenant.
    sourceId: `${tenant.tenant}:${externalPath}`,
    company: tenant.company,
    title: info.title,
    description: info.jobDescription,
    // Workday states the workplace type as a field of its own (`remoteType`:
    // `Remote`, `Hybrid`, `On-site`), which the matching funnel would never
    // see unless it is written into the location string it reads (#11).
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
