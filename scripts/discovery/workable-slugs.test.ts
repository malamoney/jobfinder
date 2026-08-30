import { describe, expect, it } from "vitest";
import { workable, workableSlugFromUrl } from "./workable-slugs";
import { slugsFromIndex } from "./common-crawl";

/**
 * Reading a Workable Slug out of a crawled URL. Workable has two Board URL
 * shapes and the crawl holds both: `apply.workable.com/{slug}` and the older
 * `{slug}.workable.com`.
 */
describe("reading a Workable Slug out of a crawled URL", () => {
  it.each([
    // The path form.
    ["https://apply.workable.com/acme/", "acme"],
    ["https://apply.workable.com/acme/j/42F822B193/", "acme"],
    ["https://apply.workable.com/1915-south-ashley/j/42F822B193", "1915-south-ashley"],
    ["https://apply.workable.com/acme/?not_found=true", "acme"],
    ["https://apply.workable.com/acme/?lng=en", "acme"],
    // The subdomain form.
    ["https://mercari.workable.com/", "mercari"],
    ["https://amax-1.workable.com/j/8BA2FA1FA6", "amax-1"],
  ])("reads %s as %s", (url, slug) => {
    expect(workableSlugFromUrl(url)).toBe(slug);
  });

  it.each([
    ["a host that is not Workable", "https://example.com/acme"],
    ["a Workable lookalike", "https://apply.workable.com.evil.com/acme"],
    ["the apply host on its own", "https://apply.workable.com/"],
    ["the posting path with no account", "https://apply.workable.com/j/ABC123"],
    ["the marketing site", "https://www.workable.com/"],
    ["the bare domain", "https://workable.com/"],
    ["a Workable-owned subdomain", "https://resources.workable.com/stories"],
    ["a path segment that will not decode", "https://apply.workable.com/foo%/"],
  ])("ignores %s", (_case, url) => {
    expect(workableSlugFromUrl(url)).toBeNull();
  });
});

describe("reading Workable Slugs out of a Common Crawl response", () => {
  const line = (url: string) => JSON.stringify({ url });

  it("returns each Slug once, across both URL shapes", () => {
    const body = [
      line("https://apply.workable.com/acme/j/1"),
      line("https://apply.workable.com/acme/"),
      line("https://acme.workable.com/"),
      line("https://globex.workable.com/j/2"),
      line("https://www.workable.com/"),
    ].join("\n");

    expect(slugsFromIndex(workable, body)).toEqual(["acme", "globex"]);
  });
});
