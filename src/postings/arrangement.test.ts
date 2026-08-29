import { describe, expect, it } from "vitest";
import { extractArrangements } from "./arrangement";

/**
 * Arrangement Extraction is a pure function over a Posting's free text (#11):
 * the Source rarely says "remote" in a field a query can read, so the funnel
 * has to pull it out of the title, the location string, and the description.
 *
 * The lower seam the testing plan allows (#2). Detection is deliberately
 * conservative about negation — "this role is not remote" must not read as
 * remote — but it does not try to resolve every contradiction a description
 * might contain; a Posting that genuinely says two things is reported as
 * saying both.
 */
describe("detecting Arrangements in free text", () => {
  it("finds remote", () => {
    expect(extractArrangements("This is a fully remote position.")).toEqual([
      "remote",
    ]);
  });

  it("finds hybrid, and does not also tag a hybrid role onsite", () => {
    expect(extractArrangements("Hybrid - London (3 days in office)")).toEqual([
      "hybrid",
    ]);
  });

  it("finds onsite from 'in person'", () => {
    expect(
      extractArrangements("This role is fully in person, five days a week."),
    ).toEqual(["onsite"]);
  });

  it("finds onsite from 'on-site'", () => {
    expect(extractArrangements("Fully on-site in our Berlin studio.")).toEqual([
      "onsite",
    ]);
  });

  it("finds full-time", () => {
    expect(extractArrangements("Full-time, permanent role.")).toEqual([
      "full-time",
    ]);
  });

  it("finds part-time", () => {
    expect(extractArrangements("We are hiring a part time barista.")).toEqual([
      "part-time",
    ]);
  });

  it("finds an employment type and a location mode together", () => {
    expect(
      extractArrangements("Full-time remote role, open to any US timezone."),
    ).toEqual(["full-time", "remote"]);
  });

  it("reports Arrangements in a stable order regardless of where they appear", () => {
    expect(
      extractArrangements("Remote-friendly. This is a part-time engagement."),
    ).toEqual(["part-time", "remote"]);
  });

  it("does not read 'not remote' as remote", () => {
    expect(extractArrangements("This role is not remote; expect to be onsite."))
      .toEqual(["onsite"]);
  });

  it("does not read 'no remote work' as remote", () => {
    expect(
      extractArrangements("No remote work is available for this position."),
    ).toEqual([]);
  });

  it("returns nothing when the text describes no arrangement", () => {
    expect(
      extractArrangements("Senior Data Scientist — San Francisco, CA"),
    ).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(extractArrangements("")).toEqual([]);
  });

  it("reads 'work from home' as remote", () => {
    expect(extractArrangements("Work from home, anywhere in the country.")).toEqual(
      ["remote"],
    );
  });
});
