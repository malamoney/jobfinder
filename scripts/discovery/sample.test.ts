import { describe, expect, it } from "vitest";
import { sample } from "./sample";

const HARVEST = Array.from({ length: 100 }, (_, index) => `slug-${index}`);

describe("sampling a harvest", () => {
  it("takes as many as it was asked for", () => {
    expect(sample(HARVEST, 10)).toHaveLength(10);
  });

  it("takes each candidate at most once", () => {
    const drawn = sample(HARVEST, 40);

    expect(new Set(drawn).size).toBe(40);
  });

  it("takes only candidates that were in the harvest", () => {
    for (const slug of sample(HARVEST, 25)) {
      expect(HARVEST).toContain(slug);
    }
  });

  it.each([
    ["more than there are", 500, HARVEST.length],
    ["none", 0, 0],
    ["a nonsensical count", -5, 0],
  ])("copes with being asked for %s", (_case, count, expected) => {
    expect(sample(HARVEST, count)).toHaveLength(expected);
  });

  it("leaves the harvest it was given alone", () => {
    const original = [...HARVEST];

    sample(HARVEST, 20);

    expect(HARVEST).toEqual(original);
  });

  // The whole reason this exists: a harvest arrives sorted, and probing the
  // first N would probe the alphabetical head — numerals and test Boards
  // rather than companies.
  it("does not simply take the front of the list", () => {
    const front = HARVEST.slice(0, 20).join();

    const draws = Array.from({ length: 20 }, () => sample(HARVEST, 20).join());

    expect(draws.every((draw) => draw === front)).toBe(false);
  });
});
