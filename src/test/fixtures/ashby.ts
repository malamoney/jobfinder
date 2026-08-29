import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * An Ashby Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to `api.ashbyhq.com`
 * on 2026-08-29, including the quirk that matters most: `compensation` is a
 * list of components — salary, equity, bonus — of which only one is pay, so a
 * fixture supplying a bare pair of numbers would let an adapter that reads the
 * equity grant as a salary pass.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything but the endpoint the source research recorded
 * fails every test — MSW refuses a request no handler declared.
 */

/** The path the Ashby adapter is expected to call. */
export function ashbyBoardUrl(slug: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
}

/**
 * Declares what an Ashby Board returns.
 *
 * MSW matches on path alone, so the query string is checked here:
 * `includeCompensation=true` is what makes Ashby send the compensation object
 * at all, and an adapter that dropped it would silently fall back to reading
 * pay out of prose for the one Source that publishes it as data.
 */
export function ashbyBoardHandler(
  slug: string,
  jobs: Array<Record<string, unknown>>,
  envelopeExtras: Record<string, unknown> = {},
) {
  return http.get(ashbyBoardUrl(slug), ({ request }) => {
    const requested = new URL(request.url).searchParams.get(
      "includeCompensation",
    );
    if (requested !== "true") {
      throw new Error(
        `Ashby Board "${slug}" was fetched without includeCompensation=true, so it would return no compensation`,
      );
    }
    return HttpResponse.json({ jobs, apiVersion: "1", ...envelopeExtras });
  });
}

/** Declares what an Ashby Board returns for the next Fetch of it. */
export function ashbyBoardReturns(
  slug: string,
  jobs: Array<Record<string, unknown>>,
): void {
  server.use(ashbyBoardHandler(slug, jobs));
}

/** Declares that an Ashby Board answers, but refuses to serve it. */
export function ashbyBoardRefuses(slug: string, status = 404): void {
  server.use(
    http.get(ashbyBoardUrl(slug), () =>
      HttpResponse.json({ error: "Board unavailable" }, { status }),
    ),
  );
}

/** One job as Ashby returns it, with `includeCompensation=true`. */
export function ashbyJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    title: "Staff Engineer, Infrastructure",
    department: "Engineering",
    team: "Platform",
    employmentType: "FullTime",
    location: "Remote - US",
    publishedAt: "2026-03-04T14:29:08.532+00:00",
    isListed: true,
    isRemote: true,
    workplaceType: "Remote",
    jobUrl: "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    applyUrl:
      "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    descriptionHtml: "<p>Build the thing.</p>",
    descriptionPlain: "Build the thing.",
    ...overrides,
  };
}

/**
 * The compensation an Ashby job carries, as a list of components.
 *
 * The equity component is always present, because it is the one a careless
 * adapter would read as pay: it is a `minValue`/`maxValue` pair like the salary
 * and is marked as pay by nothing but its `compensationType`.
 */
export function ashbyCompensation(
  salary: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    compensationTierSummary: "$180K – $220K • Offers Equity",
    summaryComponents: [
      {
        compensationType: "EquityPercentage",
        interval: "NONE",
        currencyCode: null,
        minValue: null,
        maxValue: 0.16,
      },
      ...(salary
        ? [
            {
              compensationType: "Salary",
              interval: "1 YEAR",
              currencyCode: "USD",
              ...salary,
            },
          ]
        : []),
    ],
  };
}
