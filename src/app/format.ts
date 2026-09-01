import {
  EMPLOYMENT_ARRANGEMENTS,
  LOCATION_ARRANGEMENTS,
} from "@/criteria/schema";
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

/** One place to phrase a relative age, so every card reads it the same way. */
const RELATIVE_AGE = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });

/**
 * How old a Posting is, in words — "5 days ago", "3 months ago" — for the
 * Dashboard card, where an exact date is noise and "is this fresh?" is the
 * question.
 *
 * `null` is a date the Source never published; it falls back to `formatDay`'s
 * wording ("Date not given") rather than a guess at the age. Anything under a
 * minute old reads as "just now"; everything else is bucketed to the largest
 * whole unit that fits, rounded down, so a Posting is never aged up.
 */
export function formatAge(
  date: Date | null,
  fallback = "Date not given",
): string {
  if (!date) return fallback;

  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  if (elapsed < MINUTE) return "just now";

  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    elapsed < HOUR
      ? [elapsed / MINUTE, "minute"]
      : elapsed < DAY
        ? [elapsed / HOUR, "hour"]
        : elapsed < WEEK
          ? [elapsed / DAY, "day"]
          : elapsed < MONTH
            ? [elapsed / WEEK, "week"]
            : elapsed < YEAR
              ? [elapsed / MONTH, "month"]
              : [elapsed / YEAR, "year"];

  return RELATIVE_AGE.format(-Math.floor(amount), unit);
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

/** The text shown on a card when a Posting states no location at all. */
export const LOCATION_NOT_GIVEN = "Location not given";

/** The text shown when a location string names more than one place. */
export const MULTIPLE_LOCATIONS = "Multiple locations";

/**
 * A Source joins several offices into one location string with `/` or `;` — an
 * aggregator's own delimiter, not part of any single place's name — so
 * splitting on either is enough to tell "one place, plainly written" from "a
 * list", without a gazetteer.
 */
const LOCATION_LIST_SEPARATOR_RE = /\s*[;/]\s*/;

/**
 * How a Posting's location reads on a Dashboard card (#75).
 *
 * Some Sources state one location string per role ("Cambridge, MA USA"),
 * others state several offices in one field, `/`- or `;`-joined
 * ("Fort Lauderdale, Florida, United States / Miami, Florida, United
 * States / …"). Spelling all of them out is what was breaking the card's
 * uniform height (#75) — `Multiple locations` says the same thing in a
 * predictable width, and the full string is still one hover away (the caller
 * puts it in a `title`).
 *
 * A single long location is returned as-is: the card truncates it visually
 * with a one-line CSS ellipsis (`.truncate`) rather than a hard-coded
 * character count, so it stays correct at every grid width instead of at only
 * the one width a fixed count was tuned for.
 */
export function cardLocation(location: string | null): string {
  if (!location) return LOCATION_NOT_GIVEN;

  const places = location
    .split(LOCATION_LIST_SEPARATOR_RE)
    .map((place) => place.trim())
    .filter(Boolean);

  return places.length > 1 ? MULTIPLE_LOCATIONS : location;
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

/** How each employment Arrangement reads on a tag. */
const EMPLOYMENT_LABELS: Record<
  (typeof EMPLOYMENT_ARRANGEMENTS)[number],
  string
> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
};

/**
 * The employment Arrangement(s) a Posting's text named — `["Full-time"]`,
 * `["Part-time"]`, and empty when the text said nothing.
 *
 * The commitment axis, the counterpart to `workplaceLabels`. The card shows
 * both so a role's shape is legible without opening it; the definition lists
 * that came before showed neither.
 */
export function employmentLabels(
  posting: Pick<Posting, "arrangements">,
): string[] {
  return EMPLOYMENT_ARRANGEMENTS.filter((arrangement) =>
    posting.arrangements.includes(arrangement),
  ).map((arrangement) => EMPLOYMENT_LABELS[arrangement]);
}

/**
 * The publishable Logo.dev token. `NEXT_PUBLIC_` so it is inlined into the
 * client bundle — it is meant to be sent to the browser (ADR 0011). Unset in an
 * environment that has not provisioned it, in which case every card shows a
 * monogram rather than a logo.
 */
const LOGODEV_TOKEN = process.env.NEXT_PUBLIC_LOGODEV_TOKEN;

/** The largest `size` Logo.dev's `size` parameter accepts, per its docs. */
const LOGODEV_MAX_SIZE = 800;

/**
 * The Logo.dev CDN URL for a company's icon, looked up by name (ADR 0011).
 *
 * The apply URL a Posting carries is on its applicant-tracking host
 * (`job-boards.greenhouse.io`, `jobs.lever.co`), whose favicon is the ATS's
 * mark and not the company's, and the Corpus stores no company website — so the
 * name is what there is to look up by.
 *
 * `strategy=match` asks Logo.dev to rank by exact match rather than its default
 * popular-prefix typeahead, which fuzzy-matches an unknown company onto a
 * well-known one. `fallback=404` then turns a name it still cannot place into a
 * load error rather than a generated monogram, so `CompanyIcon`'s `onError`
 * shows the app's own monogram instead.
 *
 * `size` is the pixel box the icon renders in, clamped to what the CDN allows.
 * Null when there is no name to look up or no token configured — the caller
 * shows a monogram.
 */
export function companyIconSrc(company: string, size: number): string | null {
  const name = company.trim();
  if (!name || !LOGODEV_TOKEN) return null;

  const params = new URLSearchParams({
    token: LOGODEV_TOKEN,
    size: String(Math.min(Math.max(Math.round(size), 1), LOGODEV_MAX_SIZE)),
    format: "png",
    strategy: "match",
    fallback: "404",
  });
  return `https://img.logo.dev/name/${encodeURIComponent(name)}?${params}`;
}

/**
 * The letter on the neutral disc shown when a company has no logo — its first
 * character, upper-cased, or "?" when the name has none to take.
 */
export function companyMonogram(company: string): string {
  const first = company.trim()[0];
  return first ? first.toUpperCase() : "?";
}
