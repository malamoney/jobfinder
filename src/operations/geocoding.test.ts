import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { geocodes } from "@/db/schema";
import { NOMINATIM_SEARCH_URL } from "@/geocoding/nominatim";
import { server } from "@/test/msw";
import { ensureGeocoded, forgetStaleGeocodes } from "./geocoding";

/**
 * `ensureGeocoded` is normally exercised through the matching seam, but its
 * budget and progress callback are infrastructure the hand-run warm-up
 * (`pnpm warm-geocodes`) leans on and a match run never reaches — so they get a
 * direct test here.
 */
function geocoderResolvesEverything() {
  const queries: string[] = [];
  server.use(
    http.get(NOMINATIM_SEARCH_URL, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get("q") ?? "");
      return HttpResponse.json([{ addresstype: "city", lat: "1.5", lon: "2.5" }]);
    }),
  );
  return { queries: () => [...queries] };
}

describe("ensureGeocoded", () => {
  it("geocodes at most `budget` uncached strings per call", async () => {
    const geo = geocoderResolvesEverything();

    await ensureGeocoded(getDb(), ["a", "b", "c", "d", "e"], 2);

    expect(geo.queries()).toHaveLength(2);
  });

  it("geocodes every uncached string when the budget is unbounded, reporting progress", async () => {
    const geo = geocoderResolvesEverything();
    const progress: Array<[number, number]> = [];

    await ensureGeocoded(
      getDb(),
      ["p", "q", "r", "s"],
      Number.MAX_SAFE_INTEGER,
      (done, total) => progress.push([done, total]),
    );

    expect(geo.queries()).toHaveLength(4);
    expect(progress).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    expect(await getDb().select().from(geocodes)).toHaveLength(4);
  });

  it("never re-geocodes a string that is already cached", async () => {
    const first = geocoderResolvesEverything();
    await ensureGeocoded(getDb(), ["x"], 10);
    expect(first.queries()).toEqual(["x"]);

    const second = geocoderResolvesEverything();
    await ensureGeocoded(getDb(), ["x", "y"], 10);
    expect(second.queries()).toEqual(["y"]);
  });
});

/**
 * The cache holds a row for every key the reader ever produced, and a change
 * to the reader can leave rows behind whose key no text produces any more —
 * `united states`, resolved to the centre of the country, once a country names
 * no place (#124). Those are not merely inert: they are the coordinates 1,142
 * Postings were measured against, and `pnpm warm-geocodes` drops them so the
 * cache holds only what the Corpus can still be measured on.
 */
describe("forgetStaleGeocodes", () => {
  /** A cached row: resolved to `point`, or a negative result when null. */
  async function cached(location: string, point: [number, number] | null) {
    await getDb()
      .insert(geocodes)
      .values({ location, latitude: point?.[0] ?? null, longitude: point?.[1] ?? null });
  }

  async function keys(): Promise<string[]> {
    const rows = await getDb().select({ location: geocodes.location }).from(geocodes);
    return rows.map((row) => row.location).sort();
  }

  it("drops a row whose key now names no place, and reports how many", async () => {
    await cached("united states", [39.78, -100.45]);
    await cached("usa", [39.78, -100.45]);
    await cached("canada", [61.07, -107.99]);
    await cached("boston, ma", [42.36, -71.06]);

    expect(await forgetStaleGeocodes(getDb())).toBe(3);
    expect(await keys()).toEqual(["boston, ma"]);
  });

  it("drops a state-centroid row, and keeps the state that is also a city", async () => {
    // `massachusetts` is the point in Worcester County #146 was opened on;
    // `new york` is the city in almost every text that names it, and stays.
    await cached("massachusetts", [42.26, -71.8]);
    await cached("tx", [31.05, -97.56]);
    await cached("new york", [40.71, -74.01]);
    await cached("washington", [38.9, -77.04]);

    expect(await forgetStaleGeocodes(getDb())).toBe(2);
    expect(await keys()).toEqual(["new york", "washington"]);
  });

  it("drops a row whose key the reader would now split", async () => {
    // The unplaceable key #113 was written about, cached as a negative result
    // before the reader learned to split it.
    await cached("san francisco bay area, ca / seattle, wa", null);
    await cached("seattle, wa", [47.6, -122.33]);

    expect(await forgetStaleGeocodes(getDb())).toBe(1);
    expect(await keys()).toEqual(["seattle, wa"]);
  });

  it("keeps a key nothing names any more, so a home cached before #100 survives", async () => {
    // A Criteria row stated before homes left this cache still reads its
    // point from here (`cachedHome`, `@/operations/commute`). The rule is
    // about what the reader produces, not about what the Corpus names today.
    await cached("franklin, ma", [42.08, -71.4]);
    await cached("nowhere anyone has heard of", null);

    expect(await forgetStaleGeocodes(getDb())).toBe(0);
    expect(await keys()).toEqual(["franklin, ma", "nowhere anyone has heard of"]);
  });
});
