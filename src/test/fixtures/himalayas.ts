import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * A Himalayas feed response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to
 * `himalayas.app/jobs/api` on 2026-08-29. The quirks that matter: the feed is
 * ordered newest-first, dates are epoch **seconds**, every role is remote with
 * `locationRestrictions` narrowing where, and paging is by an opaque
 * `nextCursor` that is null on the last page.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything else fails every test — MSW refuses a request no
 * handler declared.
 */

/** The path the Himalayas adapter is expected to call. */
export const HIMALAYAS_FEED_URL = "https://himalayas.app/jobs/api";

/** One job as the feed publishes it. */
export function himalayasJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    guid: "https://himalayas.app/companies/acme/jobs/staff-engineer-infrastructure",
    title: "Staff Engineer, Infrastructure",
    companyName: "Acme",
    description: "<p>Build the thing.</p>",
    applicationLink:
      "https://himalayas.app/companies/acme/jobs/staff-engineer-infrastructure",
    // Epoch seconds.
    pubDate: 1_788_026_464,
    expiryDate: 1_793_212_196,
    locationRestrictions: ["United States"],
    minSalary: 180_000,
    maxSalary: 220_000,
    salaryPeriod: "annual",
    currency: "USD",
    ...overrides,
  };
}

/**
 * Declares what the Himalayas feed returns, page by page.
 *
 * The adapter fetches `pages[0]` first, then follows `nextCursor` to each
 * subsequent page; the last page's `nextCursor` is null. A missing handler for
 * a page the adapter asks for is an MSW error, so a test that supplies two
 * pages asserts the adapter actually followed the cursor to the second.
 */
export function himalayasReturns(
  pages: Array<Array<Record<string, unknown>>>,
): void {
  server.use(
    http.get(HIMALAYAS_FEED_URL, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      const index = cursor ? Number(cursor) : 0;
      const jobs = pages[index] ?? [];
      const nextCursor =
        index + 1 < pages.length ? String(index + 1) : null;
      return HttpResponse.json({ jobs, nextCursor });
    }),
  );
}

/** Declares that the Himalayas feed answers, but refuses to serve itself. */
export function himalayasRefuses(status = 500): void {
  server.use(
    http.get(HIMALAYAS_FEED_URL, () =>
      HttpResponse.json({ error: "feed unavailable" }, { status }),
    ),
  );
}
