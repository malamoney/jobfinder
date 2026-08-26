/**
 * A Greenhouse Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to
 * `boards-api.greenhouse.io` on 2026-08-25, including the quirk that matters
 * most: `content` arrives HTML-entity-escaped, so a fixture that supplied bare
 * HTML would let a broken adapter pass.
 *
 * The URL is written out here rather than imported from the adapter, so a test
 * fails loudly (MSW refuses the request) if the adapter stops calling the
 * endpoint the source research recorded.
 */

/** The endpoint the Greenhouse adapter is expected to call. */
export function greenhouseBoardUrl(slug: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
}

type GreenhouseJobOverrides = Record<string, unknown>;

/** One job as Greenhouse returns it, with `content=true`. */
export function greenhouseJob(
  overrides: GreenhouseJobOverrides = {},
): Record<string, unknown> {
  return {
    id: 6136160004,
    internal_job_id: 5196261004,
    title: "Staff Engineer, Infrastructure",
    company_name: "Acme",
    absolute_url: "https://job-boards.greenhouse.io/acme/jobs/6136160004",
    location: { name: "Hybrid - London" },
    first_published: "2026-08-06T12:50:10-04:00",
    updated_at: "2026-08-18T18:06:19-04:00",
    requisition_id: "1311",
    content: "&lt;p&gt;Build the thing.&lt;/p&gt;",
    metadata: [],
    ...overrides,
  };
}

/** The envelope Greenhouse wraps its jobs in. */
export function greenhouseBoard(
  jobs: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return { jobs, meta: { total: jobs.length } };
}
