import { describe, expect, it } from "vitest";
import { chooseRepresentative, type Presentable } from "./dedup";

/**
 * `chooseRepresentative` is the pure rule for which member of a Dedup Key group
 * the application shows (#13, ADR 0006). Its ordering is asserted here directly,
 * rather than only incidentally through the cross-Source fixtures — the
 * description tie-break in particular, because #138 changed what it weighs (the
 * length of the description, no longer the text) and the rule must be provably
 * unchanged.
 */

/** A Dedup Key group member with only the fields the rule reads, defaults benign. */
function member(overrides: Partial<Presentable> = {}): Presentable {
  return {
    descriptionLength: 500,
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    absentFetches: 0,
    expiresAt: null,
    source: "greenhouse",
    sourceId: "1",
    ...overrides,
  };
}

describe("choosing the member of a Dedup Key group to present", () => {
  it("prefers the longer description when nothing else separates the members", () => {
    const shorter = member({ descriptionLength: 200, sourceId: "a" });
    const longer = member({ descriptionLength: 5_000, sourceId: "b" });

    expect(chooseRepresentative([shorter, longer])).toBe(longer);
    expect(chooseRepresentative([longer, shorter])).toBe(longer);
  });

  it("keeps a live listing over an Expired one even when the Expired one is far fuller", () => {
    const longExpired = member({
      descriptionLength: 10_000,
      absentFetches: 2,
      sourceId: "a",
    });
    const shortLive = member({ descriptionLength: 50, sourceId: "b" });

    expect(chooseRepresentative([longExpired, shortLive])).toBe(shortLive);
    expect(chooseRepresentative([shortLive, longExpired])).toBe(shortLive);
  });

  it("counts a passed expiry date as Expired, losing to a shorter live listing", () => {
    const longExpired = member({
      descriptionLength: 10_000,
      expiresAt: new Date(Date.now() - 1_000),
      sourceId: "a",
    });
    const shortLive = member({ descriptionLength: 50, sourceId: "b" });

    expect(chooseRepresentative([longExpired, shortLive])).toBe(shortLive);
  });

  it("breaks a description-length tie on apply-URL directness, then Source, then Source id", () => {
    const directer = member({
      applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
      source: "lever",
      sourceId: "z",
    });
    const redirector = member({
      applyUrl: "https://jobwire.example/out?job=acme-1",
      source: "greenhouse",
      sourceId: "a",
    });

    // Same description length, so directness decides despite `redirector`
    // sorting first on both Source and Source id.
    expect(chooseRepresentative([redirector, directer])).toBe(directer);
  });

  it("falls through to Source then Source id when directness ties too", () => {
    const a = member({ source: "greenhouse", sourceId: "2" });
    const b = member({ source: "greenhouse", sourceId: "1" });
    const c = member({ source: "ashby", sourceId: "9" });

    expect(chooseRepresentative([a, b, c])).toBe(c);
    expect(chooseRepresentative([a, b])).toBe(b);
  });
});
