import { describe, expect, it } from "vitest";
import { radiusAppliesTo } from "./radius-scope";
import type { Arrangement } from "@/criteria/schema";

/** What a Posting's text can say about where the work happens. */
const POSTING_ARRANGEMENTS: Record<string, Arrangement[]> = {
  "says nothing": [],
  onsite: ["onsite"],
  hybrid: ["hybrid"],
  "onsite or hybrid": ["onsite", "hybrid"],
  remote: ["remote"],
  "remote or onsite": ["remote", "onsite"],
  "remote or hybrid": ["remote", "hybrid"],
  "remote, onsite or hybrid": ["remote", "onsite", "hybrid"],
};

describe("a User who does not accept remote", () => {
  // ADR 0013: every role is a commute for them, so every resolved location is
  // measured — whatever the text says, and whether or not it says anything.
  const accepted: Arrangement[] = ["full-time", "onsite", "hybrid"];

  for (const [text, arrangements] of Object.entries(POSTING_ARRANGEMENTS)) {
    it(`measures a Posting whose text ${text}`, () => {
      expect(radiusAppliesTo(accepted, arrangements)).toBe(true);
    });
  }
});

describe("a User who accepts remote", () => {
  const accepted: Arrangement[] = ["full-time", "onsite", "hybrid", "remote"];

  it("measures a Posting whose text places it onsite", () => {
    expect(radiusAppliesTo(accepted, ["onsite"])).toBe(true);
  });

  it("measures a Posting whose text places it hybrid", () => {
    expect(radiusAppliesTo(accepted, ["hybrid"])).toBe(true);
  });

  it("leaves a Posting offering remote alone, wherever it is based", () => {
    expect(radiusAppliesTo(accepted, ["remote"])).toBe(false);
    expect(radiusAppliesTo(accepted, ["remote", "onsite"])).toBe(false);
    expect(radiusAppliesTo(accepted, ["remote", "hybrid"])).toBe(false);
  });

  it("leaves a Posting silent on its location mode alone", () => {
    expect(radiusAppliesTo(accepted, [])).toBe(false);
  });

  it("reads only the location axis, not the employment one", () => {
    expect(radiusAppliesTo(accepted, ["full-time"])).toBe(false);
    expect(radiusAppliesTo(accepted, ["full-time", "onsite"])).toBe(true);
  });
});

describe("a User who accepts remote alone", () => {
  const accepted: Arrangement[] = ["remote"];

  // They stated no distance role, so no radius is stored for them at all and
  // this is never asked. Answered on the "accepts remote" side regardless, so
  // the rule has no third reading.
  it("leaves a remote Posting alone", () => {
    expect(radiusAppliesTo(accepted, ["remote"])).toBe(false);
  });

  it("measures an onsite Posting", () => {
    expect(radiusAppliesTo(accepted, ["onsite"])).toBe(true);
  });
});
