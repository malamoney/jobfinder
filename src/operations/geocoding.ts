import { eq, inArray } from "drizzle-orm";
import type { Writer } from "@/db";
import { geocodes, type Geocode } from "@/db/schema";
import { geocode, type Coordinate } from "@/geocoding/nominatim";

/**
 * The geocode cache: resolving normalized location strings to coordinates once
 * and reusing the answer everywhere (#12).
 *
 * Geocoding is cached by normalized string rather than per Posting because the
 * same handful of strings recur across thousands of Postings. `ensureGeocoded`
 * fills the cache for the strings a match run needs; `readGeocode` reads one
 * back. The distance funnel stage in `@/operations/matching` joins the
 * `geocodes` table directly for the filter itself.
 *
 * Tested through the matching seam (`matching.test.ts`) with MSW standing in for
 * Nominatim, the same way Extraction and the Source adapters are — the geocoder
 * is not injected, it calls `fetch` and MSW controls the boundary.
 */

/**
 * The least time between two calls to Nominatim, whose usage policy is one
 * request a second. Zero in tests (`.env.test`), where MSW answers instantly and
 * there is no one to be a good citizen towards.
 */
function minIntervalMs(): number {
  const configured = Number(process.env.GEOCODER_MIN_INTERVAL_MS);
  return Number.isFinite(configured) ? configured : 1000;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * The most uncached strings one call will geocode. The rest are left for the
 * next call.
 *
 * Nominatim's usage policy is one request a second, so a warm-up of N new
 * strings costs ~N seconds of wall time — and a match run does its warm-up
 * before it can match (`warmGeocodesForMatch`). A Fetch that introduced
 * hundreds of new locations would otherwise make the first match run after it
 * take minutes, and "Run matching now" awaits that run inside the request: past
 * the platform's function ceiling it is killed outright (`FUNCTION_INVOCATION_TIMEOUT`).
 *
 * Bounding it keeps every warm-up short. Nothing is lost by deferring the
 * rest: the distance stage keeps a Posting whose location has no cache row yet
 * (surfaced, flagged unresolved — #12), and the next match run, or the nightly
 * `matchAllUsers`, geocodes the next batch.
 */
const DEFAULT_BUDGET = 12;

/**
 * Makes sure strings in `locations` have a `geocodes` row, calling the geocoder
 * only for the ones that do not — and for at most `budget` of those per call.
 *
 * Given a plain database handle rather than a transaction: each upsert stands
 * on its own, so a warm-up loop of many external calls never holds a match
 * transaction — and its locks — open across the network.
 *
 * A negative result — the geocoder resolved a string to no place — is cached
 * too, so an unresolvable string is not retried on every Fetch. A geocoder
 * *failure* is not cached: the string is left without a row and tried again
 * next time.
 *
 * `onGeocoded` is called after each lookup, so the hand-run warm-up
 * (`pnpm warm-geocodes`) — which passes an unbounded `budget` and can run for
 * minutes — can show progress.
 */
export async function ensureGeocoded(
  writer: Writer,
  locations: readonly string[],
  budget: number = DEFAULT_BUDGET,
  onGeocoded?: (done: number, ofUncached: number) => void,
): Promise<void> {
  const wanted = [...new Set(locations)];
  if (wanted.length === 0) return;

  const cached = await writer
    .select({ location: geocodes.location })
    .from(geocodes)
    .where(inArray(geocodes.location, wanted));
  const known = new Set(cached.map((row) => row.location));
  const uncached = wanted.filter((location) => !known.has(location));

  const interval = minIntervalMs();
  let calls = 0;

  for (const location of uncached) {
    if (calls >= budget) break;
    if (calls > 0) await sleep(interval);
    calls++;

    let point: Coordinate | null;
    try {
      point = await geocode(location);
    } catch {
      // A geocoder outage: leave the string uncached so it is retried, rather
      // than remembering it as unresolvable. Still counts against the budget,
      // so a geocoder that is down cannot make this loop unbounded.
      onGeocoded?.(calls, uncached.length);
      continue;
    }

    await writer
      .insert(geocodes)
      .values({
        location,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
      })
      // Another match run may have cached the same string in the meantime.
      .onConflictDoNothing();

    onGeocoded?.(calls, uncached.length);
  }
}

/**
 * The coordinate a normalized string resolved to, or null when it has no cache
 * row yet or resolved to no place.
 */
export async function readGeocode(
  writer: Writer,
  location: string,
): Promise<Coordinate | null> {
  const [row] = await writer
    .select()
    .from(geocodes)
    .where(eq(geocodes.location, location));

  return toCoordinate(row);
}

/** The coordinate a cache row carries, or null when it is a negative result. */
function toCoordinate(row: Geocode | undefined): Coordinate | null {
  if (!row || row.latitude == null || row.longitude == null) return null;
  return { latitude: row.latitude, longitude: row.longitude };
}
