import { describe, expect, it } from "vitest";
import { dedupKey } from "./dedup-key";

/**
 * The Dedup Key is a pure function over a Posting's company, title, and
 * location (#13) — the lower seam the testing plan allows (#2), alongside
 * salary Extraction and distance.
 *
 * It is approximate identity across Sources: two listings of the same opening
 * should share a key, and it must be cheap and deterministic with no fuzzy
 * matching. These tests pin what "the same opening" means and, just as
 * importantly, what it does not.
 */
describe("deriving a Dedup Key", () => {
  const opening = {
    company: "Acme",
    title: "Staff Engineer, Backend",
    location: "San Francisco, CA",
  };

  it("is stable across case, punctuation, and whitespace", () => {
    expect(
      dedupKey({
        company: "  ACME,  Inc. ",
        title: "Staff Engineer - Backend",
        location: "san francisco,  ca",
      }),
    ).toBe(dedupKey(opening));
  });

  it("folds accents so a name written two ways still groups", () => {
    expect(dedupKey({ ...opening, company: "Zürich Insurance" })).toBe(
      dedupKey({ ...opening, company: "Zurich Insurance" }),
    );
  });

  it("ignores a company's legal-form punctuation but not a different word", () => {
    expect(dedupKey({ ...opening, company: "Acme Inc." })).toBe(
      dedupKey({ ...opening, company: "Acme  Inc" }),
    );
    expect(dedupKey({ ...opening, company: "Acme Labs" })).not.toBe(
      dedupKey(opening),
    );
  });

  it("groups two listings whose location differs only by a remote alternative", () => {
    expect(
      dedupKey({ ...opening, location: "San Francisco, CA / Remote" }),
    ).toBe(dedupKey(opening));
  });

  it("treats every place-less listing as the same location", () => {
    const remote = dedupKey({ ...opening, location: "Remote" });
    expect(dedupKey({ ...opening, location: null })).toBe(remote);
    expect(dedupKey({ ...opening, location: "Anywhere" })).toBe(remote);
  });

  it("keeps openings in different places apart", () => {
    expect(dedupKey({ ...opening, location: "New York, NY" })).not.toBe(
      dedupKey(opening),
    );
  });

  it("keeps different titles at the same company and place apart", () => {
    expect(dedupKey({ ...opening, title: "Staff Engineer, Frontend" })).not.toBe(
      dedupKey(opening),
    );
  });

  it("does not let a company/title split collide with a different split", () => {
    expect(
      dedupKey({ company: "Acme Inc", title: "Staff", location: "Remote" }),
    ).not.toBe(
      dedupKey({ company: "Acme", title: "Inc Staff", location: "Remote" }),
    );
  });
});
