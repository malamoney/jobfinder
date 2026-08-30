import { describe, expect, it } from "vitest";
import { slugsFromIndex } from "./common-crawl";
import { lever, leverSlugFromUrl } from "./lever-slugs";

/**
 * Reading a Lever Slug out of a crawled URL. The Slug is the first path
 * segment. Only `jobs.lever.co` is read — the EU board host needs an API this
 * adapter does not call (see the module comment).
 */
describe("reading a Lever Slug out of a crawled URL", () => {
  it.each([
    ["https://jobs.lever.co/voleon", "voleon"],
    ["https://jobs.lever.co/voleon/6a4f2c19-1b2d-4f8e-9a1c-3d5e7f9b0a2c", "voleon"],
    ["https://jobs.lever.co/acme/6a4f2c19-1b2d/apply", "acme"],
    ["https://jobs.lever.co/hooli-labs/1?lever-source=x", "hooli-labs"],
    // Lever leaves a Slug's case as the company typed it; the API wants it
    // lowercase.
    ["https://jobs.lever.co/Voleon/1", "voleon"],
  ])("reads %s as %s", (url, slug) => {
    expect(leverSlugFromUrl(url)).toBe(slug);
  });

  it.each([
    ["a host that is not Lever", "https://example.com/acme/1"],
    ["the EU board host, which this adapter cannot fetch", "https://jobs.eu.lever.co/seb/1"],
    ["a Lever lookalike", "https://jobs.lever.co.evil.com/acme"],
    ["the host on its own", "https://jobs.lever.co/"],
    ["robots.txt", "https://jobs.lever.co/robots.txt"],
    ["the embed widget", "https://jobs.lever.co/embed/acme"],
    ["something that is not a URL", "jobs.lever.co/acme"],
  ])("ignores %s", (_case, url) => {
    expect(leverSlugFromUrl(url)).toBeNull();
  });
});

describe("reading Lever Slugs out of a Common Crawl response", () => {
  const line = (url: string) => JSON.stringify({ url });

  it("returns each Slug once, however many postings it was crawled under", () => {
    const body = [
      line("https://jobs.lever.co/voleon/1"),
      line("https://jobs.lever.co/voleon/2"),
      line("https://jobs.lever.co/matterport/3"),
      line("https://jobs.lever.co/robots.txt"),
    ].join("\n");

    expect(slugsFromIndex(lever, body)).toEqual(["matterport", "voleon"]);
  });
});
