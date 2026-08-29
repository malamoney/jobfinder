import type { Posting } from "@/db/schema";

/**
 * How the app writes a date where a person will read it.
 *
 * One place, so the Dashboard, the details page, and the review controls all
 * say a date the same way. `null` is a date the Source never published (or a
 * Status that has not happened), shown as a short note rather than a guess.
 */
export function formatDay(date: Date | null, fallback = "Not given"): string {
  if (!date) return fallback;
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The salary text shown when Extraction found no salary in a Posting. */
export const SALARY_NOT_LISTED = "Not listed";

/**
 * How the app writes a Posting's salary.
 *
 * A Posting whose text stated no salary reads as "not listed", never as a
 * number or a zero — an unknown must never be mistaken for a match on pay (#2,
 * user story 36). Everything else is shown in the unit the Source used:
 * `salary_min` and `salary_max` are stored in that unit already (Extraction),
 * so this only groups the digits and adds "/hr" for an hourly Posting.
 */
export function formatSalary(
  posting: Pick<Posting, "salaryMin" | "salaryMax" | "salaryPeriod">,
): string {
  const { salaryMin, salaryMax, salaryPeriod } = posting;
  if (salaryMin == null || salaryMax == null || salaryPeriod == null) {
    return SALARY_NOT_LISTED;
  }

  const range =
    salaryMin === salaryMax
      ? money(salaryMin)
      : `${money(salaryMin)}–${money(salaryMax)}`;
  return salaryPeriod === "hour" ? `${range}/hr` : range;
}

/** A dollar figure with thousands separators. */
function money(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
