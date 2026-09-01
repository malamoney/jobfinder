import { describe, expect, it } from "vitest";
import {
  companyIconSrc,
  companyMonogram,
  employmentLabels,
  formatAge,
  formatSalary,
  SALARY_NOT_LISTED,
  workplaceLabels,
} from "./format";

/** A date the given number of whole days before now. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * How a Posting's salary reads on the Dashboard and the details page.
 *
 * The one rule the spec is emphatic about (#2, user story 36): a Posting that
 * stated no salary shows "not listed", never a number and never a zero, so an
 * unknown is never mistaken for a match on pay. `salary_min` / `salary_max` are
 * stored in the Posting's own unit, so this is grouping and a suffix, nothing
 * more.
 */
describe("writing a Posting's salary", () => {
  it("says 'not listed' when Extraction found no salary", () => {
    expect(
      formatSalary({ salaryMin: null, salaryMax: null, salaryPeriod: null }),
    ).toBe(SALARY_NOT_LISTED);
  });

  it("writes an annual range with thousands separators", () => {
    expect(
      formatSalary({
        salaryMin: 150_000,
        salaryMax: 200_000,
        salaryPeriod: "year",
      }),
    ).toBe("$150,000–$200,000");
  });

  it("writes a single annual figure once, not as a range", () => {
    expect(
      formatSalary({
        salaryMin: 180_000,
        salaryMax: 180_000,
        salaryPeriod: "year",
      }),
    ).toBe("$180,000");
  });

  it("writes an hourly Posting as an hourly rate", () => {
    expect(
      formatSalary({ salaryMin: 72, salaryMax: 72, salaryPeriod: "hour" }),
    ).toBe("$72/hr");
  });

  it("writes an hourly range as a range of rates", () => {
    expect(
      formatSalary({ salaryMin: 60, salaryMax: 75, salaryPeriod: "hour" }),
    ).toBe("$60–$75/hr");
  });
});

/**
 * The workplace tag on a card. It answers "why is a role in Virginia matching
 * my Massachusetts radius" — because it is remote, and the radius does not
 * apply to a remote role.
 */
describe("the workplace Arrangement tag", () => {
  it("names the where-you-work Arrangement the text stated", () => {
    expect(workplaceLabels({ arrangements: ["full-time", "remote"] })).toEqual([
      "Remote",
    ]);
    expect(workplaceLabels({ arrangements: ["hybrid"] })).toEqual(["Hybrid"]);
    expect(workplaceLabels({ arrangements: ["onsite", "part-time"] })).toEqual([
      "Onsite",
    ]);
  });

  it("shows every workplace Arrangement when the text named more than one", () => {
    expect(
      workplaceLabels({ arrangements: ["remote", "hybrid"] }),
    ).toEqual(["Remote", "Hybrid"]);
  });

  it("is empty when the text named no workplace — the funnel's 'silent' case", () => {
    expect(workplaceLabels({ arrangements: [] })).toEqual([]);
    expect(workplaceLabels({ arrangements: ["full-time"] })).toEqual([]);
  });
});

/**
 * The relative age shown on a Dashboard card — "is this fresh?", not the exact
 * date. A date the Source never published falls back to `formatDay`'s wording.
 */
describe("writing a Posting's age", () => {
  it("writes a span of days as days ago", () => {
    expect(formatAge(daysAgo(5))).toBe("5 days ago");
  });

  it("rounds down to the largest whole unit — 100 days is 3 months ago", () => {
    expect(formatAge(daysAgo(100))).toBe("3 months ago");
  });

  it("writes something older than a year in years", () => {
    expect(formatAge(daysAgo(400))).toBe("1 year ago");
  });

  it("reads as 'just now' for a Posting seen this minute", () => {
    expect(formatAge(new Date())).toBe("just now");
  });

  it("never ages a Posting into the future", () => {
    expect(formatAge(new Date(Date.now() + 60_000))).toBe("just now");
  });

  it("falls back to the not-given wording when the Source published no date", () => {
    expect(formatAge(null)).toBe("Date not given");
    expect(formatAge(null, "No date")).toBe("No date");
  });
});

/**
 * The employment tag on a card — the commitment axis, alongside the workplace
 * one. `full-time` / `part-time` were filtered out of the old card; the design
 * shows both.
 */
describe("the employment Arrangement tag", () => {
  it("names the commitment the text stated, ignoring the workplace axis", () => {
    expect(employmentLabels({ arrangements: ["full-time", "remote"] })).toEqual([
      "Full-time",
    ]);
    expect(employmentLabels({ arrangements: ["part-time"] })).toEqual([
      "Part-time",
    ]);
  });

  it("shows both when the text named both", () => {
    expect(
      employmentLabels({ arrangements: ["part-time", "full-time"] }),
    ).toEqual(["Full-time", "Part-time"]);
  });

  it("is empty when the text named no employment commitment", () => {
    expect(employmentLabels({ arrangements: [] })).toEqual([]);
    expect(employmentLabels({ arrangements: ["remote"] })).toEqual([]);
  });
});

/**
 * The company mark on a Dashboard card (#62).
 *
 * The logo is looked up by company name from Logo.dev's CDN (ADR 0011); a
 * company it cannot place falls back to a monogram. `.env.test` sets a fake
 * `NEXT_PUBLIC_LOGODEV_TOKEN` so the URL is deterministic here.
 */
describe("the Logo.dev icon URL for a company", () => {
  it("looks the company up by name against Logo.dev's CDN", () => {
    const src = companyIconSrc("Stripe", 40);
    expect(src).not.toBeNull();
    const url = new URL(src!);
    expect(url.origin).toBe("https://img.logo.dev");
    expect(url.pathname).toBe("/name/Stripe");
    expect(url.searchParams.get("token")).toBe("pk_test_logodev");
  });

  it("ranks by exact match and asks for a 404 on a miss, so the card shows its own monogram", () => {
    const url = new URL(companyIconSrc("Acme", 40)!);
    expect(url.searchParams.get("strategy")).toBe("match");
    expect(url.searchParams.get("fallback")).toBe("404");
  });

  it("passes the render size through, clamped to Logo.dev's maximum", () => {
    expect(new URL(companyIconSrc("Acme", 80)!).searchParams.get("size")).toBe(
      "80",
    );
    expect(
      new URL(companyIconSrc("Acme", 2400)!).searchParams.get("size"),
    ).toBe("800");
  });

  it("encodes a company name with spaces and symbols", () => {
    const url = new URL(companyIconSrc("Ben & Jerry's", 40)!);
    expect(url.pathname).toBe("/name/Ben%20%26%20Jerry's");
  });

  it("is null when there is no name to look up", () => {
    expect(companyIconSrc("", 40)).toBeNull();
    expect(companyIconSrc("   ", 40)).toBeNull();
  });
});

/**
 * The monogram shown when there is no logo — the company's first initial on a
 * neutral disc, so a card never shows a broken image or an empty corner.
 */
describe("a company's monogram", () => {
  it("is the first letter of the name, upper-cased", () => {
    expect(companyMonogram("stripe")).toBe("S");
    expect(companyMonogram("  acme corp")).toBe("A");
  });

  it("is a question mark when the name has no first character", () => {
    expect(companyMonogram("")).toBe("?");
    expect(companyMonogram("   ")).toBe("?");
  });
});
