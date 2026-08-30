import { describe, expect, it } from "vitest";
import { DISCOVERY_SOURCES, discoverySourceFor } from "./sources";

describe("resolving a --source flag", () => {
  it.each(Object.keys(DISCOVERY_SOURCES))(
    "resolves %s to a harvester for that Source",
    (name) => {
      const source = discoverySourceFor(name);
      expect(source.source).toBe(name);
      expect(source.patterns.length).toBeGreaterThan(0);
    },
  );

  it("covers Greenhouse and the four ATS Sources from #14", () => {
    expect(Object.keys(DISCOVERY_SOURCES).sort()).toEqual([
      "ashby",
      "greenhouse",
      "lever",
      "recruitee",
      "workable",
    ]);
  });

  // A typo should stop the run at once, not harvest Greenhouse by surprise.
  it("throws on an unknown Source, naming what is on offer", () => {
    expect(() => discoverySourceFor("linkedin")).toThrow(/unknown --source/);
    expect(() => discoverySourceFor("linkedin")).toThrow(/greenhouse/);
  });

  // `--source constructor` reaches a prototype key with `in`; it must be
  // treated as unknown like any other name that is not a Source.
  it.each(["constructor", "toString", "hasOwnProperty"])(
    "treats the inherited key %s as unknown",
    (name) => {
      expect(() => discoverySourceFor(name)).toThrow(/unknown --source/);
    },
  );

  // The aggregators and Workday have no harvesting path by design (ADR 0003).
  it.each(["usajobs", "himalayas", "workday"])(
    "has no harvester for %s",
    (name) => {
      expect(() => discoverySourceFor(name)).toThrow();
    },
  );
});
