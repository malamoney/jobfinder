import { describe, expect, it } from "vitest";
import { formatSalary, SALARY_NOT_LISTED } from "./format";

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
