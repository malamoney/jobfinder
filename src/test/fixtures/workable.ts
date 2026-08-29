import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * A Workable Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to
 * `apply.workable.com` on 2026-08-29, including the quirk that matters most:
 * Workable returns one entry per job *per location*, so a role open in two
 * cities arrives twice under one `shortcode`.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything but the endpoint the source research recorded
 * fails every test — MSW refuses a request no handler declared.
 */

/** The path the Workable adapter is expected to call. */
export function workableBoardUrl(slug: string): string {
  return `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
}

/**
 * Declares what a Workable Board returns.
 *
 * MSW matches on path alone, so the query string is checked here: Workable
 * omits descriptions unless asked for them, and an adapter that dropped
 * `details=true` would quietly fill the Corpus with Postings that have no
 * description rather than fail.
 */
export function workableBoardHandler(
  slug: string,
  jobs: Array<Record<string, unknown>>,
  envelopeExtras: Record<string, unknown> = {},
) {
  return http.get(workableBoardUrl(slug), ({ request }) => {
    if (new URL(request.url).searchParams.get("details") !== "true") {
      throw new Error(
        `Workable Board "${slug}" was fetched without details=true, so it would return no descriptions`,
      );
    }
    return HttpResponse.json({
      name: "Acme",
      description: "<p>About Acme.</p>",
      jobs,
      ...envelopeExtras,
    });
  });
}

/** Declares what a Workable Board returns for the next Fetch of it. */
export function workableBoardReturns(
  slug: string,
  jobs: Array<Record<string, unknown>>,
): void {
  server.use(workableBoardHandler(slug, jobs));
}

/** Declares that a Workable Board answers, but refuses to serve it. */
export function workableBoardRefuses(slug: string, status = 404): void {
  server.use(
    http.get(workableBoardUrl(slug), () =>
      HttpResponse.json({ error: "Board unavailable" }, { status }),
    ),
  );
}

/** One job as Workable returns it, with `details=true`. */
export function workableJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "Staff Engineer, Infrastructure",
    shortcode: "D26AEB4351",
    code: "",
    employment_type: "Full-time",
    // Remote by default: the matching funnel reads Arrangements out of the
    // location (#11), so a neutral default keeps tests that don't care about
    // Arrangement from tripping the filter.
    telecommuting: true,
    department: "Engineering",
    url: "https://apply.workable.com/j/D26AEB4351",
    shortlink: "https://apply.workable.com/j/D26AEB4351",
    application_url: "https://apply.workable.com/j/D26AEB4351/apply",
    published_on: "2026-06-17",
    created_at: "2026-04-21",
    country: "United States",
    city: "Atlanta",
    state: "Georgia",
    locations: [
      {
        country: "United States",
        countryCode: "US",
        city: "Atlanta",
        region: "Georgia",
        hidden: false,
      },
    ],
    description: "<p>Build the thing.</p>",
    ...overrides,
  };
}
