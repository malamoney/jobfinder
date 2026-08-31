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
});
