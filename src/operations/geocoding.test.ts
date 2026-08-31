import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { geocodes } from "@/db/schema";
import { NOMINATIM_SEARCH_URL } from "@/geocoding/nominatim";
import { server } from "@/test/msw";
import { ensureGeocoded } from "./geocoding";

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
