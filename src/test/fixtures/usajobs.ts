import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * A USAJOBS search response, shaped like the real one.
 *
 * Fields and their spellings were taken from the USAJOBS API reference and a
 * live call to `data.usajobs.gov` on 2026-08-29. The quirks that matter: the
 * announcement lives two levels down under `MatchedObjectDescriptor`, the pay
 * figures are strings, and the page count comes back under
 * `SearchResult.UserArea.NumberOfPages` as a string.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything else fails every test — MSW refuses a request no
 * handler declared.
 */

/** The path the USAJOBS adapter is expected to call. */
export const USAJOBS_SEARCH_URL = "https://data.usajobs.gov/api/search";

/** One announcement's descriptor, as USAJOBS nests it. */
export function usajobsDescriptor(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    PositionTitle: "Staff Engineer, Infrastructure",
    PositionURI: "https://www.usajobs.gov/job/833819900",
    OrganizationName: "Naval Air Systems Command",
    DepartmentName: "Department of the Navy",
    PositionLocationDisplay: "Patuxent River, Maryland",
    PositionLocation: [{ LocationName: "Patuxent River, Maryland" }],
    UserArea: { Details: { JobSummary: "Build the thing." } },
    QualificationSummary: "You have built things before.",
    PositionRemuneration: [
      {
        MinimumRange: "112015.0",
        MaximumRange: "145617.0",
        // The Search API spells the period as a phrase here, not a code.
        RateIntervalCode: "Per Year",
        Description: "$112,015 to $145,617 per year",
      },
    ],
    PublicationStartDate: "2026-08-06",
    ApplicationCloseDate: "2026-09-06",
    ...overrides,
  };
}

/** One search result item: the descriptor under its control number. */
export function usajobsItem(
  overrides: Record<string, unknown> = {},
  id = "833819900",
): Record<string, unknown> {
  return {
    MatchedObjectId: id,
    MatchedObjectDescriptor: usajobsDescriptor(overrides),
  };
}

/** The envelope USAJOBS wraps one page of results in. */
function usajobsPage(
  items: Array<Record<string, unknown>>,
  pageCount: number,
): Record<string, unknown> {
  return {
    SearchResult: {
      SearchResultCount: items.length,
      SearchResultItems: items,
      UserArea: { NumberOfPages: String(pageCount) },
    },
  };
}

/**
 * Declares what a USAJOBS keyword search returns, page by page.
 *
 * `pages[0]` is served for `Page=1`, and so on; a `Page` past the end returns
 * an empty page. The `Authorization-Key` header is checked here — USAJOBS
 * serves an error without it, and an adapter that forgot the key would be
 * parsing that.
 */
export function usajobsReturns(
  pages: Array<Array<Record<string, unknown>>>,
): void {
  server.use(
    http.get(USAJOBS_SEARCH_URL, ({ request }) => {
      if (!request.headers.get("Authorization-Key")) {
        return HttpResponse.json(
          { error: "an API key is required" },
          { status: 401 },
        );
      }
      const page = Number(new URL(request.url).searchParams.get("Page") ?? 1);
      const items = pages[page - 1] ?? [];
      return HttpResponse.json(usajobsPage(items, pages.length));
    }),
  );
}

/** Declares that USAJOBS answers, but refuses to serve the search. */
export function usajobsRefuses(status = 500): void {
  server.use(
    http.get(USAJOBS_SEARCH_URL, () =>
      HttpResponse.json({ error: "USAJOBS unavailable" }, { status }),
    ),
  );
}
