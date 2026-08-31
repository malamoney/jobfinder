import { LOCATION_ARRANGEMENTS } from "@/criteria/schema";
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

/**
 * A date with the time of day, for the last-Fetch line on the Dashboard (#17) —
 * "the sweep ran an hour ago" is only answerable if the clock time is shown.
 */
export function formatDateTime(date: Date | null, fallback = "Never"): string {
  if (!date) return fallback;
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

/** How each workplace Arrangement reads on a tag. */
const WORKPLACE_LABELS: Record<
  (typeof LOCATION_ARRANGEMENTS)[number],
  string
> = {
  remote: "Remote",
  onsite: "Onsite",
  hybrid: "Hybrid",
};

/**
 * The workplace Arrangement(s) a Posting's text named — `["Remote"]`,
 * `["Hybrid"]`, occasionally two, and empty when the text said nothing.
 *
 * Only the where-you-work axis: `full-time` / `part-time` are not a place.
 * Shown as a tag so a role a User's radius did not filter out is legible at a
 * glance — a remote role is HQ'd somewhere, and its address on the card is not
 * where the work is.
 */
export function workplaceLabels(
  posting: Pick<Posting, "arrangements">,
): string[] {
  return LOCATION_ARRANGEMENTS.filter((arrangement) =>
    posting.arrangements.includes(arrangement),
  ).map((arrangement) => WORKPLACE_LABELS[arrangement]);
}
