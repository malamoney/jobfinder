import { z } from "zod";

/**
 * The geocoder: turning a normalized location string into a coordinate, or
 * nothing when the place cannot be placed (#12).
 *
 * Nominatim (OpenStreetMap) is the Source. It needs no API key and bills
 * nothing, and its usage policy — one request a second, a User-Agent that names
 * the caller — is comfortably within what this does: lookups are cached by
 * normalized string (`@/operations/geocoding`), so after a short warm-up the
 * Corpus resolves almost entirely from cache and this is barely called.
 *
 * Tested through the matching seam (`matching.test.ts`) with MSW standing in for
 * Nominatim, the same way the Greenhouse adapter is tested through `fetchBoard`.
 */

/** A place on the Earth, in degrees. */
export type Coordinate = {
  latitude: number;
  longitude: number;
};

/** The endpoint the geocoder calls. Written out so a test can intercept it. */
export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Identifies the caller to Nominatim, as its usage policy requires. A request
 * without this is served a block page rather than results.
 */
const USER_AGENT = "Jobfinder/0.1 (+https://github.com/malamoney/jobfinder)";

/** The ceiling on one lookup, so a Nominatim that stalls does not stall a match run. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How many results to weigh. Nominatim ranks by a relevance score that can put
 * a region above a same-named place — `Franklin County` before the town of
 * Franklin, MA — so the top hit alone is not enough to pick from.
 */
const RESULT_LIMIT = 5;

/**
 * Address types that name a whole region rather than somewhere a person lives.
 * A result of one of these is skipped when a later result names an actual
 * place, so a commute radius is centred on the town the User typed and not on
 * the county that outranked it.
 */
const REGION_TYPES = new Set([
  "county",
  "state",
  "state_district",
  "region",
  "province",
  "country",
  "continent",
]);

/**
 * What the adapter depends on from a Nominatim result, and nothing more.
 * `lat`/`lon` arrive as strings; `addresstype` is jsonv2's label for what the
 * result is — `city`, `town`, `county`, `state`.
 */
const nominatimResults = z.array(
  z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    addresstype: z.string().nullish(),
  }),
);

/**
 * The coordinate Nominatim resolves `query` to, or null when it resolves to
 * nothing.
 *
 * Not simply the top hit: Nominatim's relevance score can rank a region above a
 * same-named place (`franklin, ma` → Franklin County, ~90 miles from the town),
 * so this weighs the first few and prefers one that names an actual place. It
 * falls back to the top hit when every result is a region, or when there is
 * only one.
 *
 * Null is a definite answer — Nominatim understood the request and found no
 * place — and it is safe to cache. A transport or parse failure throws instead,
 * so a Nominatim outage does not poison the cache with "unresolvable" for a
 * string that would resolve fine tomorrow.
 */
export async function geocode(
  query: string,
  signal: AbortSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
): Promise<Coordinate | null> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(RESULT_LIMIT));

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Nominatim returned ${response.status} ${response.statusText} for "${query}"`,
    );
  }

  const parsed = nominatimResults.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Nominatim returned a response this adapter does not understand for "${query}"`,
    );
  }

  const results = parsed.data;
  const chosen =
    results.find((r) => !REGION_TYPES.has(r.addresstype ?? "")) ?? results[0];
  return chosen ? { latitude: chosen.lat, longitude: chosen.lon } : null;
}
