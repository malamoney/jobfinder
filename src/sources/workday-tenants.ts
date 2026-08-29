/**
 * The hand-picked Workday tenants a Fetch is allowed to sweep.
 *
 * Workday is the one Source whose Board cannot be addressed from a Slug alone
 * (ADR 0003, #16). Three things vary per tenant and none is derivable:
 *
 * - the `wd{N}` **shard** that is part of the hostname,
 * - the career-**site** name that is part of the request path,
 * - the **search** that narrows the tenant to the roles this Corpus is for.
 *
 * The search is not a nicety. Workday needs a detail request per job, which
 * makes it ~100× more request-expensive per Board than any other Source, so a
 * tenant is pulled as the slice of itself that matches a keyword — `engineer`,
 * `software` — rather than whole. ADR 0003 already scopes the Corpus to
 * venture-backed tech, salaried white-collar, and remote eng/design/PM; this
 * is that scope applied at the request.
 *
 * This map is that configuration, maintained by hand. A Slug not in it cannot
 * be fetched — `resolveWorkdayTenant` in `./workday` throws — which is the "no
 * harvesting path" #16 asks for: discovery (#18) can turn up a
 * `myworkdayjobs.com` hostname, but its shard, site, and search are a person's
 * to fill in here before a sweep will touch it.
 *
 * `search` is a fixed part of a tenant's identity, not a knob to tune between
 * Fetches. Expiry reads a Posting absent from a successful Fetch as gone (ADR
 * 0004), so the set of jobs a Fetch sees has to be the same set night to
 * night. Changing a tenant's search re-scopes what "absent" means and will
 * expire and re-add roles for one night.
 */
export type WorkdayTenant = {
  /** The `{tenant}` in `{tenant}.wd{N}.myworkdayjobs.com` and in the CxS path. */
  tenant: string;
  /** The `wd{N}` shard in the hostname — `wd1`, `wd5`. Not derivable. */
  shard: string;
  /** The career-site name in the CxS path — `NVIDIAExternalCareerSite`. */
  site: string;
  /**
   * The company as a Posting should name it. Workday's detail response carries
   * a hiring-organization name, but not on every tenant, and a Posting must
   * carry one — it is displayed and it is a third of the Dedup Key.
   */
  company: string;
  /**
   * The keyword sent as Workday's `searchText`, scoping the tenant to the
   * roles the Corpus is for. Fixed once set — see the module note.
   */
  search: string;
};

/**
 * The configured tenants, keyed by Slug.
 *
 * Grown by hand as tenants are verified. A tenant whose shard or site is wrong
 * fails its seed probe (`scripts/seed-boards.ts`) and is added disabled rather
 * than sweeping a dead address every night.
 */
export const WORKDAY_TENANTS: Record<string, WorkdayTenant> = {
  nvidia: {
    tenant: "nvidia",
    shard: "wd5",
    site: "NVIDIAExternalCareerSite",
    company: "NVIDIA",
    search: "engineer",
  },
};
