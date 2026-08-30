import { describe, expect, it } from "vitest";
import { ashby, ashbySlugFromUrl } from "./ashby-slugs";
import { slugsFromIndex } from "./common-crawl";

/**
 * Reading an Ashby Slug out of a crawled URL. The Slug is the first path
 * segment; a posting hangs off it as `/{slug}/{uuid}`.
 */
describe("reading an Ashby Slug out of a crawled URL", () => {
  it.each([
    ["https://jobs.ashbyhq.com/openai", "openai"],
    ["https://jobs.ashbyhq.com/openai/6a4f2c19-1b2d-4f8e-9a1c-3d5e7f9b0a2c", "openai"],
    ["https://jobs.ashbyhq.com/1password/2951e57f-d0c1-4cdc-b0b7-ed62075aaf9a/application", "1password"],
    ["https://jobs.ashbyhq.com/hims-and-hers/abc?utm_source=getro.com", "hims-and-hers"],
    // Ashby leaves a Slug's case as the company typed it.
    ["https://jobs.ashbyhq.com/Crusoe/abc", "crusoe"],
  ])("reads %s as %s", (url, slug) => {
    expect(ashbySlugFromUrl(url)).toBe(slug);
  });

  it.each([
    ["a host that is not Ashby", "https://example.com/openai"],
    ["an Ashby lookalike", "https://jobs.ashbyhq.com.evil.com/openai"],
    ["the host on its own", "https://jobs.ashbyhq.com/"],
    ["robots.txt", "https://jobs.ashbyhq.com/robots.txt"],
    ["the application-builder path", "https://jobs.ashbyhq.com/b/some-form"],
    ["the embed widget", "https://jobs.ashbyhq.com/embed/openai"],
  ])("ignores %s", (_case, url) => {
    expect(ashbySlugFromUrl(url)).toBeNull();
  });
});

describe("reading Ashby Slugs out of a Common Crawl response", () => {
  const line = (url: string) => JSON.stringify({ url });

  it("returns each Slug once, however many postings it was crawled under", () => {
    const body = [
      line("https://jobs.ashbyhq.com/openai/1"),
      line("https://jobs.ashbyhq.com/openai/2"),
      line("https://jobs.ashbyhq.com/ramp/3"),
      line("https://jobs.ashbyhq.com/robots.txt"),
    ].join("\n");

    expect(slugsFromIndex(ashby, body)).toEqual(["openai", "ramp"]);
  });
});
