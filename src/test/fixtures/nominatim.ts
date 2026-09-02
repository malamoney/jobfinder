import { http, HttpResponse } from "msw";
import { NOMINATIM_SEARCH_URL, type Coordinate } from "@/geocoding/nominatim";
import { server } from "@/test/msw";

export type { Coordinate };

/**
 * Nominatim standing in for the real geocoder.
 *
 * The geocoder is tested through the matching seam (`matching.test.ts`), the
 * same way the Greenhouse adapter is tested through `fetchBoard`: a test
 * declares what the geocoder knows, and the assertions are about which Postings
 * a User's radius surfaces.
 *
 * The endpoint is imported from the adapter so a query sent anywhere else fails
 * every test — MSW refuses a request no handler declared.
 */

/** A handle onto what the geocoder was actually asked. */
export type GeocoderCalls = {
  /** The query strings sent to Nominatim so far, in order. */
  queries(): string[];
};

/**
 * A place the geocoder knows, and how precisely it can place it.
 *
 * `place_rank` is Nominatim's own grading of a match — 30 a house number, 26 a
 * road, 16 a city, 8 a state — and is what the adapter reads to decide whether
 * a User's home location reached their front door or only their city (#100).
 * Left off, a place answers the way an ordinary city lookup does.
 */
export type Place = Coordinate & { placeRank?: number };

/** Nominatim's grading for a plain city hit, the default a fixture stands in. */
const CITY_RANK = 16;

/**
 * Declares the coordinates the geocoder can resolve, keyed by the exact query
 * string it will be sent — the normalized location for a Posting, the address
 * exactly as the User typed it for a home. A query with no entry resolves to
 * nothing, the way Nominatim answers for a place it cannot find.
 */
export function geocoderKnows(
  places: Record<string, Place>,
): GeocoderCalls {
  const queries: string[] = [];

  server.use(
    http.get(NOMINATIM_SEARCH_URL, ({ request }) => {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      queries.push(query);

      const hit = places[query];
      return HttpResponse.json(
        hit
          ? [
              {
                lat: String(hit.latitude),
                lon: String(hit.longitude),
                place_rank: hit.placeRank ?? CITY_RANK,
                display_name: query,
              },
            ]
          : [],
      );
    }),
  );

  return { queries: () => [...queries] };
}

/**
 * Declares the geocoder cannot be reached at all — every lookup throws. The
 * case the negative cache must not swallow: a string left uncached and retried,
 * not remembered as unresolvable.
 */
export function geocoderIsDown(): GeocoderCalls {
  const queries: string[] = [];

  server.use(
    http.get(NOMINATIM_SEARCH_URL, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get("q") ?? "");
      return HttpResponse.error();
    }),
  );

  return { queries: () => [...queries] };
}
