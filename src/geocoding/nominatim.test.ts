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
    expect(point).toEqual({ latitude: 42.0825801, longitude: -71.3971167 });
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
    });
  });
});
