import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw";
import { geocode, NOMINATIM_SEARCH_URL } from "./nominatim";

/**
 * Nominatim ranks a region above a same-named town for a bare "Town, ST" query.
 * This is exactly the shape it returns for `franklin, ma` (verified live
 * 2026-08-30): Franklin *County* (western MA) first, the *town* of Franklin
 * (near the RI border, ~90 miles away) second.
 */
const FRANKLIN_MA = [
  {
    addresstype: "county",
    lat: "42.5896205",
    lon: "-72.6110645",
    display_name: "Franklin County, Massachusetts, United States",
  },
  {
    addresstype: "town",
    lat: "42.0825801",
    lon: "-71.3971167",
    display_name: "Franklin, Norfolk County, Massachusetts, United States",
  },
];

describe("geocode resolves a place name, not a region of the same name", () => {
  it("picks the town of Franklin, MA over Franklin County", async () => {
    server.use(
      http.get(NOMINATIM_SEARCH_URL, () => HttpResponse.json(FRANKLIN_MA)),
    );

    const point = await geocode("franklin, ma");

    // The town — a home a 40-mile commute radius is drawn around, not a county
    // 90 miles from it.
    expect(point).toEqual({
      latitude: 42.0825801,
      longitude: -71.3971167,
      precision: "city",
    });
  });

  it("takes the top result when none of them is a whole region", async () => {
    server.use(
      http.get(NOMINATIM_SEARCH_URL, () =>
        HttpResponse.json([
          { addresstype: "city", lat: "42.3588336", lon: "-71.0578303" },
          { addresstype: "suburb", lat: "42.33", lon: "-71.08" },
        ]),
      ),
    );

    expect(await geocode("boston, ma")).toEqual({
      latitude: 42.3588336,
      longitude: -71.0578303,
      precision: "city",
    });
  });
});

/**
 * A User's home location is asked for as a street address (#100), and the
 * Criteria page tells them when what they gave only reached their city. Which
 * of the two it was is Nominatim's judgement, read from `place_rank` — its own
 * grading of the match — rather than guessed from the shape of what was typed.
 */
describe("how precisely a result was placed", () => {
  /** Answers one result carrying the given fields. */
  function nominatimAnswers(result: Record<string, unknown>) {
    server.use(
      http.get(NOMINATIM_SEARCH_URL, () =>
        HttpResponse.json([{ lat: "42.35", lon: "-71.06", ...result }]),
      ),
    );
  }

  it("calls a house number exact", async () => {
    nominatimAnswers({ addresstype: "house", place_rank: 30 });

    expect(await geocode("12 Beacon St, Boston, MA")).toMatchObject({
      precision: "exact",
    });
  });

  it("calls a city a city", async () => {
    nominatimAnswers({ addresstype: "city", place_rank: 16 });

    expect(await geocode("boston, ma")).toMatchObject({ precision: "city" });
  });

  it("calls a street with no number a city, not an address", async () => {
    nominatimAnswers({ addresstype: "road", place_rank: 26 });

    expect(await geocode("Beacon St, Boston, MA")).toMatchObject({
      precision: "city",
    });
  });

  it("calls a state an area", async () => {
    nominatimAnswers({ addresstype: "state", place_rank: 8 });

    expect(await geocode("Massachusetts")).toMatchObject({ precision: "area" });
  });

  it("reads the address type when a result carries no rank", async () => {
    nominatimAnswers({ addresstype: "building" });

    expect(await geocode("Fenway Park")).toMatchObject({ precision: "exact" });
  });

  it("understates rather than overstates for a type it does not know", async () => {
    nominatimAnswers({ addresstype: "something_new" });

    expect(await geocode("somewhere")).toMatchObject({ precision: "city" });
  });
});
