import { describe, expect, it } from "vitest";
import {
  joinKeywords,
  splitKeywords,
  withKeyword,
  withoutKeyword,
  withRequiredToggled,
  type KeywordEntry,
} from "./keyword-modes";

/**
 * The Criteria form shows keywords as one list a User toggles between the two
 * modes (#136); the schema stores them as two arrays (#135, ADR 0017). These
 * are the functions that carry a list across that boundary and edit it in
 * place — covered here as functions, since the repo has no component-render
 * seam, the way `src/postings/location.test.ts` covers location parsing.
 */

const TS_REQUIRED: KeywordEntry = { term: "TypeScript", required: true };
const POSTGRES: KeywordEntry = { term: "postgres", required: false };
const GO: KeywordEntry = { term: "go", required: false };

describe("splitting the toggled list into the two arrays a save posts", () => {
  it("puts each keyword in the list its mode names", () => {
    expect(splitKeywords([POSTGRES, TS_REQUIRED, GO])).toEqual({
      keywords: ["postgres", "go"],
      requiredKeywords: ["TypeScript"],
    });
  });

  it("posts two empty lists for no keywords at all", () => {
    expect(splitKeywords([])).toEqual({ keywords: [], requiredKeywords: [] });
  });
});

describe("joining the two arrays a save returns into one toggled list", () => {
  it("marks each keyword with the mode it was stored in, required first", () => {
    expect(joinKeywords(["postgres", "go"], ["TypeScript"])).toEqual([
      TS_REQUIRED,
      POSTGRES,
      GO,
    ]);
  });

  it("brings every keyword back in the mode it was saved in", () => {
    // Story 8: reopening the page shows what was left there. The stored
    // ordering is required-first, so that is what a round trip settles on.
    const entries = [POSTGRES, TS_REQUIRED, GO];
    const { keywords, requiredKeywords } = splitKeywords(entries);

    expect(joinKeywords(keywords, requiredKeywords)).toEqual([
      TS_REQUIRED,
      POSTGRES,
      GO,
    ]);
  });
});

describe("adding a keyword", () => {
  it("adds a new keyword as widening, the default mode", () => {
    expect(withKeyword([POSTGRES], "go")).toEqual([POSTGRES, GO]);
  });

  it("trims what was typed and ignores a blank", () => {
    expect(withKeyword([POSTGRES], "  go  ")).toEqual([POSTGRES, GO]);
    expect(withKeyword([POSTGRES], "   ")).toEqual([POSTGRES]);
  });

  it("does not add a keyword already in the list, whatever its case", () => {
    // Story 12: matching is case-insensitive, so `typescript` and
    // `TypeScript` are the same keyword to the funnel. A second copy in the
    // other mode would be the contradiction the form exists to prevent — and
    // it would win by being required, silently, on the schema side.
    expect(withKeyword([TS_REQUIRED], "typescript")).toEqual([TS_REQUIRED]);
    expect(withKeyword([POSTGRES], "Postgres")).toEqual([POSTGRES]);
  });
});

describe("toggling and removing a keyword", () => {
  it("flips a widening keyword to required and back", () => {
    const required = withRequiredToggled([POSTGRES, GO], "go");
    expect(required).toEqual([POSTGRES, { term: "go", required: true }]);

    expect(withRequiredToggled(required, "go")).toEqual([POSTGRES, GO]);
  });

  it("keeps the keyword where it was in the list when toggled", () => {
    expect(withRequiredToggled([POSTGRES, TS_REQUIRED, GO], "TypeScript")).toEqual(
      [POSTGRES, { term: "TypeScript", required: false }, GO],
    );
  });

  it("removes a keyword in either mode", () => {
    expect(withoutKeyword([POSTGRES, TS_REQUIRED], "TypeScript")).toEqual([
      POSTGRES,
    ]);
    expect(withoutKeyword([POSTGRES, TS_REQUIRED], "postgres")).toEqual([
      TS_REQUIRED,
    ]);
  });
});
