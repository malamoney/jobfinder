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
