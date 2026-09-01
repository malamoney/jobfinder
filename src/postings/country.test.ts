import { describe, expect, it } from "vitest";
import { extractCountry } from "./country";

describe("reading a Posting's country from its location text", () => {
  it.each([
    ["San Francisco, CA", "us"],
    ["New York, NY", "us"],
    ["Austin, Texas", "us"],
    ["Boston, MA, USA", "us"],
    ["Washington, D.C.", "us"],
    ["United States", "us"],
    ["USA", "us"],
    ["US", "us"],
    ["U.S.", "us"],
    ["Remote - US", "us"],
    ["Remote (United States)", "us"],
    ["Remote, USA", "us"],
    ["US - Remote", "us"],
    ["US-based, fully remote", "us"],
    ["San Francisco, CA / New York, NY / Remote", "us"],
    // A role open in the US and abroad is still open in the US.
    ["New York, NY or London, UK", "us"],
    ["Remote - US or Canada", "us"],
  ])("reads %j as %s", (location, country) => {
    expect(extractCountry(location)).toBe(country);
  });

  it.each([
    ["London, UK", "non-us"],
    ["Berlin, Germany", "non-us"],
    ["Toronto, Canada", "non-us"],
    ["Toronto, ON, Canada", "non-us"],
    ["Vancouver, BC", "non-us"],
    ["Remote - EMEA", "non-us"],
    ["Remote (EU)", "non-us"],
    ["Paris, France", "non-us"],
    ["Bangalore, India", "non-us"],
    ["Sydney, Australia", "non-us"],
  ])("reads %j as %s", (location, country) => {
    expect(extractCountry(location)).toBe(country);
  });

  it.each([
    ["Remote", "unknown"],
    ["Fully remote", "unknown"],
    ["Multiple locations", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["Anywhere", "unknown"],
  ])("reads %j as %s", (location, country) => {
    expect(extractCountry(location)).toBe(country);
  });

  // "Columbus" contains "us" but is not a country marker; the state it is in is.
  it("does not mistake a city name that contains 'us' for a country marker", () => {
    expect(extractCountry("Columbus, OH")).toBe("us");
  });

  /**
   * The shape that leaked non-US roles onto the Dashboard (#67): an ATS Board
   * writes `City, CC` with a two-letter country code as often as it spells the
   * country out, and every code that doubles as a USPS state code — `CA`, `DE`,
   * `IN`, … — was being read as that state.
   */
  describe("a two-letter country code after the city", () => {
    it.each([
      // Codes that are not also a USPS state code.
      ["Amsterdam, NL", "non-us"],
      ["Paris, FR", "non-us"],
      ["Madrid, ES", "non-us"],
      ["Milan, IT", "non-us"],
      ["Tokyo, JP", "non-us"],
      ["London, GB", "non-us"],
      ["Dublin, IE", "non-us"],
      ["São Paulo, BR", "non-us"],
      ["Singapore, SG", "non-us"],
      ["Sydney, AU", "non-us"],
      // Codes that collide with a USPS state code — resolved by the city.
      ["Toronto, CA", "non-us"],
      ["Vancouver, CA", "non-us"],
      ["Montréal, CA", "non-us"],
      ["Berlin, DE", "non-us"],
      ["Munich, DE", "non-us"],
      ["Bangalore, IN", "non-us"],
      ["Bengaluru, IN", "non-us"],
      ["Mumbai, IN", "non-us"],
      ["Bogotá, CO", "non-us"],
      ["Buenos Aires, AR", "non-us"],
      ["Tel Aviv, IL", "non-us"],
    ])("reads %j as %s", (location, country) => {
      expect(extractCountry(location)).toBe(country);
    });

    it("keeps the US reading of a colliding code next to a US city", () => {
      expect(extractCountry("San Francisco, CA")).toBe("us");
      expect(extractCountry("Sacramento, CA")).toBe("us");
      expect(extractCountry("Wilmington, DE")).toBe("us");
      expect(extractCountry("Indianapolis, IN")).toBe("us");
      expect(extractCountry("Denver, CO")).toBe("us");
    });

    it("keeps a US reading when a colliding code sits on an unknown city", () => {
      // ADR 0010's rule: never silently drop a role that might be American. An
      // unrecognised `City, DE` stays US rather than becoming a dropped unknown.
      expect(extractCountry("Millsboro, DE")).toBe("us");
    });

    it("is not fooled by a lowercase code buried in prose", () => {
      expect(extractCountry("Open to anyone, in office optional")).toBe("unknown");
      expect(extractCountry("This role, is fully remote")).toBe("unknown");
    });

    it("still lets an explicit US signal win over a foreign code", () => {
      expect(extractCountry("Remote - US; team also in Berlin, DE")).toBe("us");
    });
  });
});
