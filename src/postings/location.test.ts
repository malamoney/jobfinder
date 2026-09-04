import { describe, expect, it } from "vitest";
import {
  normalizeLocation,
  normalizeLocations,
  placesNamed,
} from "./location";

/**
 * Location normalization is a pure function over a Posting's free-text location
 * (#12). Geocoding is cached by the string this returns, not per Posting —
 * `Greater Boston Area` recurs across thousands of Postings and should cost one
 * external call, not thousands.
 *
 * The lower seam the testing plan allows (#2). It formats a messy location into
 * a stable key a geocoder can read, and returns null when the text names no
 * place at all — a null is surfaced as unresolved, never geocoded.
 */
describe("normalizing a Posting's location", () => {
  it("lowercases and collapses whitespace so spelling variants share a key", () => {
    expect(normalizeLocation("San Francisco,  CA")).toBe("san francisco, ca");
    expect(normalizeLocation("  New York,\tNY  ")).toBe("new york, ny");
  });

  it("strips a trailing remote alternative, keeping the place", () => {
    expect(normalizeLocation("San Francisco, CA / Remote")).toBe(
      "san francisco, ca",
    );
    expect(normalizeLocation("Austin, TX (Remote)")).toBe("austin, tx");
    expect(normalizeLocation("Boston, MA or Remote")).toBe("boston, ma");
  });

  it("strips a leading arrangement label, keeping the place", () => {
    expect(normalizeLocation("Hybrid - London")).toBe("london");
    expect(normalizeLocation("Remote - US")).toBe("us");
    expect(normalizeLocation("Onsite: Berlin")).toBe("berlin");
  });

  it("drops a parenthetical aside", () => {
    expect(normalizeLocation("Hybrid - London (3 days in office)")).toBe(
      "london",
    );
  });

  it("keeps a vague but real place name", () => {
    expect(normalizeLocation("Greater Boston Area")).toBe("greater boston area");
  });

  it("returns null when the text names no place", () => {
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation("")).toBeNull();
    expect(normalizeLocation("   ")).toBeNull();
    expect(normalizeLocation("Remote")).toBeNull();
    expect(normalizeLocation("Fully remote")).toBeNull();
    expect(normalizeLocation("Multiple locations")).toBeNull();
    expect(normalizeLocation("Various")).toBeNull();
    expect(normalizeLocation("Anywhere")).toBeNull();
  });
});

/**
 * A Posting whose location names more than one place (#113). `San Francisco Bay
 * Area, CA / Seattle, WA` used to normalize to one key no geocoder could place,
 * so the radius kept the Posting for everybody, everywhere, permanently.
 *
 * The rule is deliberately narrow: split on separators that only ever stand
 * between two places, and leave everything else exactly as it was. An unsplit
 * string behaves today the way it behaved before this existed, which is the
 * direction to be wrong in.
 */
describe("reading the places a Posting's location names", () => {
  it("splits a location written with a spaced slash", () => {
    expect(
      normalizeLocations("Hybrid - San Francisco Bay Area, CA / Seattle, WA"),
    ).toEqual(["san francisco bay area, ca", "seattle, wa"]);
  });

  it("splits on a semicolon and on a pipe", () => {
    expect(normalizeLocations("Boston, MA; New York, NY")).toEqual([
      "boston, ma",
      "new york, ny",
    ]);
    expect(normalizeLocations("Boston, MA | New York, NY")).toEqual([
      "boston, ma",
      "new york, ny",
    ]);
  });

  it("never splits on a comma, which sits inside a single place", () => {
    expect(normalizeLocations("Franklin, MA")).toEqual(["franklin, ma"]);
  });

  it("never splits a slash a place name is written with", () => {
    expect(normalizeLocations("Dallas/Fort Worth, TX")).toEqual([
      "dallas/fort worth, tx",
    ]);
  });

  it("reads a single-place location exactly as the single normalizer does", () => {
    expect(normalizeLocations("San Francisco,  CA")).toEqual([
      "san francisco, ca",
    ]);
    expect(normalizeLocations("Austin, TX (Remote)")).toEqual(["austin, tx"]);
    expect(normalizeLocations("Hybrid - London (3 days in office)")).toEqual([
      "london",
    ]);
  });

  it("drops the parts that name no place, keeping the ones that do", () => {
    expect(normalizeLocations("San Francisco, CA / Remote")).toEqual([
      "san francisco, ca",
    ]);
    expect(normalizeLocations("Remote / Multiple locations")).toEqual([]);
  });

  it("keeps one entry for a place named twice", () => {
    expect(normalizeLocations("Boston, MA / Boston,  MA")).toEqual([
      "boston, ma",
    ]);
  });

  it("returns nothing when the text names no place at all", () => {
    expect(normalizeLocations(null)).toEqual([]);
    expect(normalizeLocations("")).toEqual([]);
    expect(normalizeLocations("Remote")).toEqual([]);
  });
});

/**
 * The employer's own words for each place, kept beside the key so a screen
 * measuring against one of several places can say which one it measured (#113).
 */
describe("naming the places a location text names", () => {
  it("keeps each place as the employer capitalised it", () => {
    expect(
      placesNamed("Hybrid - San Francisco Bay Area, CA / Seattle, WA"),
    ).toEqual([
      { stated: "San Francisco Bay Area, CA", key: "san francisco bay area, ca" },
      { stated: "Seattle, WA", key: "seattle, wa" },
    ]);
  });

  it("names a single place as the whole location, labels aside", () => {
    expect(placesNamed("Hybrid - London (3 days in office)")).toEqual([
      { stated: "London", key: "london" },
    ]);
  });

  it("leaves a remote alternative out of the place's name", () => {
    expect(placesNamed("Boston, MA / Austin, TX or Remote")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
      { stated: "Austin, TX", key: "austin, tx" },
    ]);
  });
});

/**
 * The two readings of a slash the rule cannot tell apart, pinned so the choice
 * is a decision rather than an accident (#113, ADR 0016).
 */
describe("a slash between two halves of one metro", () => {
  it("reads a spaced metro as its two towns, which are both real places", () => {
    expect(normalizeLocations("Dallas / Fort Worth, TX")).toEqual([
      "dallas",
      "fort worth, tx",
    ]);
  });
});

/**
 * A word between two places (#119, ADR 0016). Employers join two places with
 * `or` as readily as with a slash — `Denver, CO or Menlo Park, CA` — and the
 * key that made was one no geocoder could place, which is the exact condition
 * #113 was opened about reached by a different spelling.
 *
 * The word `or` is also Oregon's postal code, so the rule has to tell the
 * separator from the state: after a comma, `OR` is the state.
 */
describe("a word between two places", () => {
  it("splits a location whose places are joined by 'or'", () => {
    expect(normalizeLocations("Denver, CO or Menlo Park, CA")).toEqual([
      "denver, co",
      "menlo park, ca",
    ]);
    expect(normalizeLocations("Herndon, VA OR Columbia, MD")).toEqual([
      "herndon, va",
      "columbia, md",
    ]);
    expect(
      normalizeLocations("Massachusetts OR Maryland OR Greater Austin, TX"),
    ).toEqual(["massachusetts", "maryland", "greater austin, tx"]);
  });

  it("reads Oregon's postal code as the state, not as a separator", () => {
    expect(normalizeLocations("Portland, OR")).toEqual(["portland, or"]);
    expect(normalizeLocations("Portland, OR or Seattle, WA")).toEqual([
      "portland, or",
      "seattle, wa",
    ]);
    expect(normalizeLocations("Portland,  OR  or  Seattle, WA")).toEqual([
      "portland, or",
      "seattle, wa",
    ]);
    expect(normalizeLocations("Eugene, OR or Bend, OR")).toEqual([
      "eugene, or",
      "bend, or",
    ]);
  });

  it("still reads a remote alternative as no second place", () => {
    expect(normalizeLocations("Boston, MA or Remote")).toEqual(["boston, ma"]);
    // A country-wide remote alternative reads as the country, exactly as
    // `Remote - US` has always read — the split does not change that, it just
    // reaches it one part at a time.
    expect(normalizeLocations("Houston, TX or Remote, USA")).toEqual([
      "houston, tx",
      "usa",
    ]);
    expect(placesNamed("Boston, MA or Remote")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
    ]);
  });

  it("drops the conjunction a preceding separator left at the front", () => {
    expect(
      normalizeLocations("San Diego, CA; Seattle, WA; or New York, NY"),
    ).toEqual(["san diego, ca", "seattle, wa", "new york, ny"]);
    expect(placesNamed("Boston, MA; or Austin, TX")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
      { stated: "Austin, TX", key: "austin, tx" },
    ]);
  });

  it("keeps the opening word of a place whose name begins with one", () => {
    // Nothing separated the first part, so its `Or` is the place's own name.
    expect(normalizeLocations("Or Yehuda, Israel")).toEqual([
      "or yehuda, israel",
    ]);
    expect(normalizeLocations("Or Yehuda, Israel; Boston, MA")).toEqual([
      "or yehuda, israel",
      "boston, ma",
    ]);
  });

  it("leaves the separators it was not taught alone", () => {
    expect(
      normalizeLocations("San Fernando Valley & Pasadena, CA"),
    ).toEqual(["san fernando valley & pasadena, ca"]);
    expect(normalizeLocations("Fort Wayne, IN. Mooresville, IN.")).toEqual([
      "fort wayne, in. mooresville, in.",
    ]);
    expect(normalizeLocations("Wilkes-Barre, PA, Reno, NV, or Batesville, IN")).toEqual([
      "wilkes-barre, pa, reno, nv, or batesville, in",
    ]);
  });
});

/**
 * A separator inside a parenthetical aside is not a separator: the aside is
 * taken off the whole text before it is split, so a bracket cannot be broken
 * across two places (#119). `Remote - US (East / Central)` used to normalize to
 * `us (east` and `central)`, two keys a geocoder answered with a point that
 * described neither.
 */
describe("a separator inside a parenthetical aside", () => {
  it("splits nothing inside the brackets, and keeps the place outside them", () => {
    expect(normalizeLocations("Remote - US (East / Central)")).toEqual(["us"]);
    expect(normalizeLocations("Remote (East Coast USA or Canada) / UK")).toEqual([
      "uk",
    ]);
    expect(normalizeLocations("United States (Remote or Hybrid)")).toEqual([
      "united states",
    ]);
  });

  it("still splits the separators outside the brackets", () => {
    expect(
      normalizeLocations("Boston, MA (HQ) / Austin, TX (3 days in office)"),
    ).toEqual(["boston, ma", "austin, tx"]);
  });
});
