import { describe, expect, it } from "vitest";
import { annualise, extractSalary } from "./salary";

/**
 * Salary Extraction is a pure function over a Posting's free text (#11). A
 * Source almost never states pay in a field a query could read, so the shape a
 * minimum-salary filter needs — a low and a high figure, and a unit — has to be
 * pulled out of prose written a hundred different ways.
 *
 * This is the lower seam the testing plan allows (#2): the input space is
 * combinatorial and driving it through Fetches would be absurd, so it is tested
 * here, directly, across the formats a real Board uses.
 *
 * The rule the acceptance criteria rest on: when the text states no salary, the
 * answer is `null`, never a guess. A Posting with no stated salary must pass a
 * floor, and it can only do that if Extraction admits it does not know.
 */
describe("extracting a salary from free text", () => {
  describe("ranges", () => {
    it("reads a dollar range stated with both bounds", () => {
      expect(extractSalary("The salary range is $150,000 - $200,000 per year."))
        .toEqual({ min: 150_000, max: 200_000, period: "year" });
    });

    it("reads a range written with 'to' instead of a dash", () => {
      expect(extractSalary("Compensation: $120,000 to $160,000")).toEqual({
        min: 120_000,
        max: 160_000,
        period: "year",
      });
    });

    it("reads a k-suffixed range with no currency symbol", () => {
      expect(extractSalary("Base salary of 150k–180k depending on level"))
        .toEqual({ min: 150_000, max: 180_000, period: "year" });
    });

    it("propagates a k-suffix stated once across the whole range", () => {
      expect(extractSalary("Pay band: $90k - $120k")).toEqual({
        min: 90_000,
        max: 120_000,
        period: "year",
      });
    });

    it("reads an hourly range in its own unit", () => {
      expect(extractSalary("Hourly rate: $60.00 - $75.00 per hour")).toEqual({
        min: 60,
        max: 75,
        period: "hour",
      });
    });

    it("annualises a monthly range so nothing downstream needs a third unit", () => {
      expect(extractSalary("Stipend: $4,000 - $6,000 per month")).toEqual({
        min: 48_000,
        max: 72_000,
        period: "year",
      });
    });
  });

  describe("single values", () => {
    it("reads a single annual figure as both bounds", () => {
      expect(extractSalary("Compensation for this role is $180,000.")).toEqual({
        min: 180_000,
        max: 180_000,
        period: "year",
      });
    });

    it("reads 'up to' a figure as a single value", () => {
      expect(extractSalary("Salary up to $210,000 for the right candidate."))
        .toEqual({ min: 210_000, max: 210_000, period: "year" });
    });

    it("reads a bare k-suffixed single value with no currency symbol", () => {
      expect(extractSalary("Targeting 165k for this level.")).toEqual({
        min: 165_000,
        max: 165_000,
        period: "year",
      });
    });

    it("reads a single hourly rate", () => {
      expect(extractSalary("This role pays $72/hr.")).toEqual({
        min: 72,
        max: 72,
        period: "hour",
      });
    });
  });

  describe("currency symbols", () => {
    it("reads a figure written with a plain dollar sign", () => {
      expect(extractSalary("$95,000/year")).toEqual({
        min: 95_000,
        max: 95_000,
        period: "year",
      });
    });

    it("reads a figure written with a USD prefix", () => {
      expect(extractSalary("Salary: USD 200,000")).toEqual({
        min: 200_000,
        max: 200_000,
        period: "year",
      });
    });

    it("does not read a non-dollar figure as a dollar salary", () => {
      // Comparing a pound figure to a floor stated in dollars would be worse
      // than admitting the salary is unknown.
      expect(
        extractSalary("£90,000 - £110,000 depending on experience"),
      ).toBeNull();
    });
  });

  describe("when the text states no salary", () => {
    it("returns null for an empty string", () => {
      expect(extractSalary("")).toBeNull();
    });

    it("returns null when pay is only described, not stated", () => {
      expect(
        extractSalary("Pay is competitive and commensurate with experience."),
      ).toBeNull();
    });

    it("returns null for 'DOE'", () => {
      expect(extractSalary("Compensation depends on experience (DOE).")).toBeNull();
    });

    it("does not mistake a 401(k) match for a salary", () => {
      expect(
        extractSalary("We offer a 401(k) with up to a 4% company match."),
      ).toBeNull();
    });

    it("does not mistake a relocation or signing figure for a salary", () => {
      expect(
        extractSalary("Includes a $25,000 relocation package and an $8,000 signing bonus."),
      ).toBeNull();
    });

    it("does not mistake a headcount range for a salary", () => {
      expect(extractSalary("Join our team of 200 to 300 engineers.")).toBeNull();
    });

    it("does not mistake a funding figure for a salary", () => {
      expect(
        extractSalary("We recently raised $150,000,000 in our Series C."),
      ).toBeNull();
    });
  });

  describe("in context", () => {
    it("finds the salary among other dollar figures in a description", () => {
      const description = [
        "About the role: you will own our billing platform.",
        "We offer a 401(k) match and a $1,500 home-office budget.",
        "The base salary range for this position is $170,000 - $195,000.",
        "Equity and benefits are on top of base.",
      ].join(" ");

      expect(extractSalary(description)).toEqual({
        min: 170_000,
        max: 195_000,
        period: "year",
      });
    });
  });

  describe("annualise", () => {
    it("multiplies an hourly rate out by full-time hours", () => {
      expect(annualise(72, "hour")).toBe(72 * 2080);
    });

    it("leaves a yearly figure alone", () => {
      expect(annualise(180_000, "year")).toBe(180_000);
    });
  });
});
