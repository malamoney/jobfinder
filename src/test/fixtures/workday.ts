import { http, HttpResponse } from "msw";
import type { WorkdayTenant } from "@/sources/workday-tenants";
import { server } from "@/test/msw";

/**
 * A Workday tenant's responses, shaped like the real ones.
 *
 * Endpoints and field spellings were taken from the source research
 * (`docs/research/job-sources.md`, verified against NVIDIA and Salesforce on
 * 2026-08-29). The quirks that matter: the job list is a **POST** that pages
 * by `{ limit, offset }` and reports a `total`, and every job's description
 * needs a **separate GET** against its `externalPath` — so a fixture that only
 * declared the list would let an adapter that never fetched a description
 * pass.
 *
 * The endpoints are written out here from the tenant config rather than
 * imported from the adapter, so an adapter calling anything else fails every
 * test — MSW refuses a request no handler declared.
 */

/**
 * The tenant the Workday tests run against.
 *
 * `src/operations/workday-adapter.test.ts` mocks `@/sources/workday-tenants` so
 * this is the registry under test; the fixture builds its URLs from the same
 * values.
 */
export const WORKDAY_TEST_TENANT: WorkdayTenant = {
  tenant: "acme",
  shard: "wd1",
  site: "External",
  company: "Acme",
  search: "engineer",
};

function origin(tenant: WorkdayTenant): string {
  return `https://${tenant.tenant}.${tenant.shard}.myworkdayjobs.com`;
}

function cxsPath(tenant: WorkdayTenant): string {
  return `${origin(tenant)}/wday/cxs/${tenant.tenant}/${tenant.site}`;
}

/** The list endpoint the adapter is expected to POST to, for a given tenant. */
export function workdayJobsUrl(
  tenant: WorkdayTenant = WORKDAY_TEST_TENANT,
): string {
  return `${cxsPath(tenant)}/jobs`;
}

/** One entry in the job list, as Workday returns it. */
export function workdayListing(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Staff Engineer, Infrastructure",
    externalPath: "/job/US-CA-Santa-Clara/Staff-Engineer-Infrastructure_JR100042",
    locationsText: "Santa Clara, CA",
    postedOn: "Posted 5 Days Ago",
    bulletFields: ["JR100042"],
    ...overrides,
  };
}

/**
 * One job's detail document, as the GET against its `externalPath` returns it.
 *
 * `info` overrides land inside `jobPostingInfo`, where every field the adapter
 * reads lives.
 */
export function workdayDetail(
  info: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jobPostingInfo: {
      id: "JR100042",
      title: "Staff Engineer, Infrastructure",
      jobDescription: "<p>Build the thing.</p>",
      location: "Santa Clara, CA",
      additionalLocations: [],
      remoteType: "Remote",
      startDate: "2026-06-17",
      postedOn: "Posted 5 Days Ago",
      jobRequisitionId: "JR100042",
      externalUrl: `${origin(WORKDAY_TEST_TENANT)}/en-US/${WORKDAY_TEST_TENANT.site}/job/US-CA-Santa-Clara/Staff-Engineer-Infrastructure_JR100042`,
      ...info,
    },
  };
}

/** A job the tenant advertises: its list entry, and the detail its GET returns. */
export type WorkdayJob = {
  listing?: Record<string, unknown>;
  detail?: Record<string, unknown>;
};

/** How much of a tenant's list a fixture stands in for. */
type WorkdayReturnsOptions = {
  /**
   * The `total` the list reports. Defaults to the number of jobs given; pass
   * it larger to stand in for a tenant whose search matches more than the
   * fixture spells out — that is how the request-budget ceiling is exercised.
   */
  total?: number;
  pageSize?: number;
  /** The tenant these responses belong to. Defaults to the test tenant. */
  tenant?: WorkdayTenant;
};

/**
 * Declares what a Workday tenant returns: a paged job list, and a detail
 * document per job keyed by its `externalPath`.
 */
export function workdayBoardReturns(
  jobs: WorkdayJob[],
  {
    total,
    pageSize = 20,
    tenant = WORKDAY_TEST_TENANT,
  }: WorkdayReturnsOptions = {},
): void {
  const entries = jobs.map((job) => {
    const listing = job.listing ?? workdayListing();
    return {
      listing,
      detail:
        job.detail ??
        workdayDetail({
          title: listing.title,
          externalUrl: `${origin(tenant)}/en-US/${tenant.site}${String(
            listing.externalPath,
          )}`,
        }),
    };
  });
  const reportedTotal = total ?? entries.length;

  server.use(
    http.post(workdayJobsUrl(tenant), async ({ request }) => {
      const body = (await request.json()) as {
        offset?: number;
        limit?: number;
      };
      const offset = Number(body.offset ?? 0);
      const limit = Number(body.limit ?? pageSize);
      return HttpResponse.json({
        total: reportedTotal,
        jobPostings: entries
          .slice(offset, offset + limit)
          .map((entry) => entry.listing),
      });
    }),
    http.get(`${cxsPath(tenant)}/job/*`, ({ request }) => {
      const path = new URL(request.url).pathname.replace(
        `/wday/cxs/${tenant.tenant}/${tenant.site}`,
        "",
      );
      const entry = entries.find(
        (candidate) => candidate.listing.externalPath === path,
      );
      if (!entry) {
        return HttpResponse.json({ error: "no such job" }, { status: 404 });
      }
      return HttpResponse.json(entry.detail);
    }),
  );
}

/** Declares that a tenant's list endpoint answers, but refuses to serve it. */
export function workdayBoardRefuses(
  status = 500,
  tenant: WorkdayTenant = WORKDAY_TEST_TENANT,
): void {
  server.use(
    http.post(workdayJobsUrl(tenant), () =>
      HttpResponse.json({ error: "tenant unavailable" }, { status }),
    ),
  );
}
