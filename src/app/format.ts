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
