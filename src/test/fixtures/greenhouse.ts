import { http, HttpResponse } from "msw";

/**
 * A Greenhouse Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to
 * `boards-api.greenhouse.io` on 2026-08-25, including the quirk that matters
 * most: `content` arrives HTML-entity-escaped, so a fixture that supplied bare
 * HTML would let a broken adapter pass.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * the adapter calling anything but the endpoint the source research recorded
 * fails every test — MSW refuses a request no handler declared.
 */

/** The path the Greenhouse adapter is expected to call. */
export function greenhouseBoardUrl(slug: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
}

/**
 * Declares what a Greenhouse Board returns.
 *
 * MSW matches on path alone, so the query string is checked here instead:
 * Greenhouse omits descriptions unless asked for them, and an adapter that
 * dropped `content=true` would quietly fill the Corpus with Postings that have
 * no description rather than fail.
 */
export function greenhouseBoardHandler(
  slug: string,
  jobs: Array<Record<string, unknown>>,
  envelopeExtras: Record<string, unknown> = {},
) {
  return http.get(greenhouseBoardUrl(slug), ({ request }) => {
    const requested = new URL(request.url).searchParams.get("content");
    if (requested !== "true") {
      throw new Error(
        `Greenhouse Board "${slug}" was fetched without content=true, so it would return no descriptions`,
      );
    }
    return HttpResponse.json({ ...greenhouseBoard(jobs), ...envelopeExtras });
  });
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
