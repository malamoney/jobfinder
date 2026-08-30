import { describe, expect, it } from "vitest";
import { recruitee, recruiteeSlugFromUrl } from "./recruitee-slugs";
import { slugsFromIndex } from "./common-crawl";

/**
 * Reading a Recruitee Slug out of a crawled URL. Recruitee addresses a Board
 * by subdomain, so the Slug is in the hostname and has to be a DNS label.
 */
describe("reading a Recruitee Slug out of a crawled URL", () => {
  it.each([
    ["https://8advisory.recruitee.com/", "8advisory"],
    ["https://careersdeltacapita.recruitee.com/o/senior-engineer", "careersdeltacapita"],
    ["https://machinelearningreply.recruitee.com/", "machinelearningreply"],
    ["https://focus-entertainment.recruitee.com/o/job/", "focus-entertainment"],
  ])("reads %s as %s", (url, slug) => {
    expect(recruiteeSlugFromUrl(url)).toBe(slug);
  });

  it.each([
    ["a host that is not Recruitee", "https://example.com/acme"],
    ["a Recruitee lookalike", "https://acme.recruitee.com.evil.com/"],
    ["the marketing site", "https://recruitee.com/blog"],
    ["the www host", "https://www.recruitee.com/"],
    ["the support host", "https://support.recruitee.com/en/articles/1"],
    ["something that is not a URL", "acme.recruitee.com"],
  ])("ignores %s", (_case, url) => {
    expect(recruiteeSlugFromUrl(url)).toBeNull();
  });
});

describe("reading Recruitee Slugs out of a Common Crawl response", () => {
  const line = (url: string) => JSON.stringify({ url });

  it("returns each Slug once, however many pages it was crawled under", () => {
    const body = [
      line("https://8advisory.recruitee.com/"),
      line("https://8advisory.recruitee.com/o/consultant"),
      line("https://hamelin.recruitee.com/"),
      line("https://support.recruitee.com/x"),
    ].join("\n");

    expect(slugsFromIndex(recruitee, body)).toEqual(["8advisory", "hamelin"]);
  });
});
