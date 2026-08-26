import { describe, expect, it } from "vitest";
import {
  greenhouseSlugFromUrl,
  greenhouseSlugsFromIndex,
} from "./greenhouse-slugs";

/**
 * The one part of discovery worth testing on its own: everything else in the
 * script is a network call or a print, but reading a Slug out of a crawled URL
 * is a pure decision, and getting it wrong quietly poisons the candidate list.
 */
describe("reading a Slug out of a crawled URL", () => {
  it.each([
    ["https://job-boards.greenhouse.io/acme/jobs/4123456", "acme"],
    ["https://job-boards.greenhouse.io/acme", "acme"],
    ["https://boards.greenhouse.io/globex/jobs/7", "globex"],
    ["https://job-boards.greenhouse.io/initech/", "initech"],
    ["https://job-boards.greenhouse.io/hooli-labs/jobs/1", "hooli-labs"],
    ["https://job-boards.greenhouse.io/acme/jobs/1?gh_src=x", "acme"],
  ])("reads %s as %s", (url, slug) => {
    expect(greenhouseSlugFromUrl(url)).toBe(slug);
  });

  // The embed widget is what a company gets when it puts its Board inside its
  // own careers page, and it names the company in a query parameter. Reading
  // the first path segment would harvest thousands of Boards called "embed".
  it("reads the company out of the embedded board widget", () => {
    expect(
      greenhouseSlugFromUrl(
        "https://boards.greenhouse.io/embed/job_board?for=acme",
      ),
    ).toBe("acme");
  });

  it("ignores an embed that names no company", () => {
    expect(
      greenhouseSlugFromUrl("https://boards.greenhouse.io/embed/job_board"),
    ).toBeNull();
  });

  it.each([
    ["a host that is not Greenhouse", "https://example.com/acme/jobs/1"],
    ["a Greenhouse lookalike", "https://greenhouse.io.evil.com/acme"],
    ["the host on its own", "https://job-boards.greenhouse.io/"],
    ["a piece of Greenhouse rather than a company", "https://boards.greenhouse.io/jobs/1"],
    ["something that is not a URL", "job-boards.greenhouse.io/acme"],
    ["a Slug with characters Greenhouse does not use", "https://job-boards.greenhouse.io/Acme%20Corp/jobs/1"],
  ])("ignores %s", (_case, url) => {
    expect(greenhouseSlugFromUrl(url)).toBeNull();
  });
});

/**
 * Common Crawl answers in newline-delimited JSON, one record per crawled URL.
 * A Board contributes one line per job it has ever posted, so the same Slug
 * arrives hundreds of times.
 */
describe("reading Slugs out of a Common Crawl response", () => {
  const line = (url: string) =>
    JSON.stringify({ urlkey: "…", timestamp: "20260801000000", url });

  it("returns each Slug once, however many times it was crawled", () => {
    const body = [
      line("https://job-boards.greenhouse.io/acme/jobs/1"),
      line("https://job-boards.greenhouse.io/acme/jobs/2"),
      line("https://job-boards.greenhouse.io/globex/jobs/3"),
      line("https://job-boards.greenhouse.io/acme"),
    ].join("\n");

    expect(greenhouseSlugsFromIndex(body)).toEqual(["acme", "globex"]);
  });

  // The response is a stream of independent records. One truncated line is
  // not a reason to lose a harvest that took two minutes to answer.
  it("skips a line it cannot read rather than losing the harvest", () => {
    const body = [
      line("https://job-boards.greenhouse.io/acme/jobs/1"),
      '{"url": "https://job-boards.greenhou',
      "",
      line("https://job-boards.greenhouse.io/globex/jobs/2"),
    ].join("\n");

    expect(greenhouseSlugsFromIndex(body)).toEqual(["acme", "globex"]);
  });

  it("skips a record with no URL in it", () => {
    const body = [
      JSON.stringify({ error: "No Captures found" }),
      line("https://job-boards.greenhouse.io/acme/jobs/1"),
    ].join("\n");

    expect(greenhouseSlugsFromIndex(body)).toEqual(["acme"]);
  });

  it("finds nothing in an empty response", () => {
    expect(greenhouseSlugsFromIndex("")).toEqual([]);
  });
});
