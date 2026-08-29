import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * A Lever Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to `api.lever.co` on
 * 2026-08-29, including the two quirks that matter: the response is a bare
 * array with no envelope, and a description arrives in pieces — `description`,
 * then titled `lists`, then `additional` — so a fixture supplying one field
 * would let an adapter that drops the qualifications pass.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything but the endpoint the source research recorded
 * fails every test — MSW refuses a request no handler declared.
 */

/** The path the Lever adapter is expected to call. */
export function leverBoardUrl(slug: string): string {
  return `https://api.lever.co/v0/postings/${slug}`;
}

/**
 * Declares what a Lever Board returns.
 *
 * MSW matches on path alone, so the query string is checked here: without
 * `mode=json` Lever serves the board as HTML, and an adapter that dropped it
 * would be parsing a web page.
 */
export function leverBoardHandler(
  slug: string,
  postings: Array<Record<string, unknown>>,
) {
  return http.get(leverBoardUrl(slug), ({ request }) => {
    if (new URL(request.url).searchParams.get("mode") !== "json") {
      throw new Error(
        `Lever Board "${slug}" was fetched without mode=json, so it would return HTML`,
      );
    }
    return HttpResponse.json(postings);
  });
}

/** Declares what a Lever Board returns for the next Fetch of it. */
export function leverBoardReturns(
  slug: string,
  postings: Array<Record<string, unknown>>,
): void {
  server.use(leverBoardHandler(slug, postings));
}

/** Declares that a Lever Board answers, but refuses to serve it. */
export function leverBoardRefuses(slug: string, status = 404): void {
  server.use(
    http.get(leverBoardUrl(slug), () =>
      HttpResponse.json({ error: "Board unavailable" }, { status }),
    ),
  );
}

/** One posting as Lever returns it, with `mode=json`. */
export function leverPosting(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
    text: "Staff Engineer, Infrastructure",
    description: "<div>Build the thing.</div>",
    descriptionPlain: "Build the thing.",
    lists: [],
    additional: "",
    categories: {
      commitment: "Regular Full Time (Salary)",
      department: "Engineering",
      // "Remote" rather than a city: the matching funnel reads Arrangements out
      // of the location (#11), so a neutral default keeps tests that don't care
      // about Arrangement from tripping the filter.
      location: "Remote",
      allLocations: ["Remote"],
      team: "Infrastructure",
    },
    country: "US",
    workplaceType: "remote",
    createdAt: 1_553_186_035_299,
    hostedUrl: "https://jobs.lever.co/acme/33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
    applyUrl:
      "https://jobs.lever.co/acme/33538a2f-d27d-4a96-8f05-fa4b0e4d940e/apply",
    ...overrides,
  };
}
