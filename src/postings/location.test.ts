import { describe, expect, it } from "vitest";
import { normalizeLocation } from "./location";

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
