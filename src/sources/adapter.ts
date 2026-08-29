import { z } from "zod";
import type { ExtractedSalary, SalaryPeriod } from "@/postings/salary";

/**
 * What every Source adapter is built from.
 *
 * Five Sources (#5, #14) answer in five shapes, but they answer the same
 * questions, and the rules for reading them are the ingestion spine's rather
 * than any one Source's: ask over HTTP under the caller's ceiling, refuse a
 * response that is not the document it claims to be, strip fields nobody asked
 * for, and fail loudly when a field the adapter depends on is gone (ADR 0003,
 * #7). Those rules live here so a sixth adapter inherits them instead of
 * remembering them.
 *
 * What stays in each adapter is only what is true of that Source: its endpoint,
 * its field names, and the quirks the source research recorded against it.
 */

/** One Source's document, as this adapter needs it to be. */
type BoardRequest<T> = {
  /** The Source's name as an error message should say it — `Greenhouse`. */
  label: string;
  /** The Board being read, named so a failure is traceable to one company. */
  slug: string;
  url: string;
  schema: z.ZodType<T>;
  /**
   * The ceiling on how long this may take. It belongs to the caller rather
   * than to any adapter: the Worker is the one whose budget is being spent,
   * and only it knows how much of that is left (#25).
   */
  signal: AbortSignal;
};

/**
 * Fetches one Board's document and validates it.
 *
 * Every failure is phrased against the Board, because that is what the Fetch
 * Task records and what #17 lists when a Board has to be found and disabled. A
 * raw `SyntaxError` from a Source serving an HTML error page under a 200 names
 * nothing at all.
 *
 * Unknown fields are stripped rather than rejected — Zod objects drop them by
 * default — because Sources add fields without notice and rejecting a response
 * would take a whole Board down over a field nobody wanted. A field the
 * adapter *depends on* going missing is the opposite case: the Board is broken,
 * not empty, and the Fetch must fail rather than report that the Board returned
 * no Postings, which ADR 0004 would read as every Posting on it having expired.
 */
export async function readBoardDocument<T>({
  label,
  slug,
  url,
  schema,
  signal,
}: BoardRequest<T>): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `${label} Board "${slug}" returned ${response.status} ${response.statusText}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `${label} Board "${slug}" answered with a body that is not JSON`,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `${label} Board "${slug}" returned a response this adapter does not understand: ${explainIssues(
        parsed.error,
      )}`,
    );
  }
  return parsed.data;
}

/** Names the fields that were wrong, so a broken Board is diagnosable. */
function explainIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * A date as a Source stated it, or null where it stated none.
 *
 * Null rather than a guess: an unknown date is not the epoch, and the Dashboard
 * sorts on this. Three spellings are in play across the Sources — ISO 8601
 * (Greenhouse, Ashby, Workable), epoch milliseconds (Lever), and
 * `2026-08-25 11:59:25 UTC` (Recruitee) — and only the last needs help, since
 * a space where ISO wants a `T` is not a format `Date` is required to parse.
 */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;

  const date = new Date(typeof value === "string" ? isoish(value) : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-08-25 11:59:25 UTC` as `2026-08-25T11:59:25Z`. Anything else, as it came. */
function isoish(value: string): string {
  return value
    .trim()
    .replace(/ (?=\d{2}:\d{2})/, "T")
    .replace(/\s*(?:UTC|GMT)$/i, "Z");
}

/**
 * The company a Board belongs to, for the Sources that do not say.
 *
 * Lever and Ashby publish no company name anywhere in a Board's response —
 * verified against both live APIs on 2026-08-29 — so the Slug is the only thing
 * naming the company, and a Posting must carry one: it is displayed, and it is
 * a third of the Dedup Key.
 *
 * Separators become spaces and each word is capitalised, which is what makes
 * this worth more than storing the Slug raw: `acme-inc` becomes `Acme Inc`,
 * whose Dedup Key matches the `Acme, Inc.` the same company publishes on
 * Greenhouse. Casing a Slug already carries is left alone (`openAI` stays
 * `OpenAI`), and the Dedup Key folds case anyway.
 */
export function companyFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{Lowercase_Letter}/gu, (letter) => letter.toUpperCase());
}

/** How the work is performed, as a location string says it. */
export type WorkplaceLabel = "Remote" | "Hybrid" | "Onsite";

/**
 * The place a Posting names, carrying an Arrangement the Source published
 * structurally.
 *
 * The Corpus holds one free-text location per Posting and Extraction reads the
 * Arrangement back out of it (#11) — `Remote - US`, `Hybrid - London` are the
 * shapes it knows. Four of the five Sources state the workplace type in a field
 * of its own instead, and an adapter that dropped it would publish a remote
 * role that no Arrangement filter can ever see as remote. So it is written
 * where the funnel looks, in the spelling the funnel reads.
 *
 * Nothing is invented: the label is prefixed only when the Source published it,
 * and not at all when the place already says it, so an Ashby `Remote - US`
 * does not become `Remote - Remote - US`. `normalizeLocation` strips the label
 * again before geocoding, so the place is still geocoded as a place.
 */
export function placeNamed(
  workplace: WorkplaceLabel | null,
  place: string | null | undefined,
): string | null {
  const named = place?.trim() || null;
  if (!workplace) return named;
  if (!named) return workplace;
  return new RegExp(`^${workplace}\\b`, "i").test(named)
    ? named
    : `${workplace} - ${named}`;
}

/**
 * Several places a Posting names, as one location string.
 *
 * Workable publishes a job once per location and Lever lists every location on
 * one, so the Sources that say more than one place have to say it in the one
 * field the Corpus holds. Joined with ` / ` — the separator Greenhouse Boards
 * already use for `San Francisco, CA / Remote` — and every place is kept.
 *
 * Keeping only the first would be the silent failure: a role open in Atlanta
 * and in Florida would quietly stop existing for everyone outside Atlanta, and
 * they would never find out. All of them named means the string may not
 * geocode, and a Posting that does not geocode is surfaced as an unresolved
 * location rather than dropped (CONTEXT.md, "Unresolved location") — visible,
 * which is the failure worth having.
 */
export function placesNamed(places: Array<string | null | undefined>): string | null {
  const named = [
    ...new Set(places.map((place) => place?.trim()).filter(Boolean)),
  ] as string[];
  return named.length === 0 ? null : named.join(" / ");
}

/** Pay exactly as a Source published it, before it is believed. */
export type StatedPay = {
  /** The ISO code. Anything but USD is not read — see below. */
  currency: string | null | undefined;
  period: "year" | "month" | "hour" | null | undefined;
  min: number | string | null | undefined;
  max: number | string | null | undefined;
};

/** Months in a year, for pay stated per month. Mirrors salary Extraction. */
const MONTHS_PER_YEAR = 12;

/**
 * A salary a Source published structurally, or null where it published none
 * this can be trusted.
 *
 * Preferred over regex Extraction wherever a Source offers it (#14): Ashby,
 * Lever, and Recruitee all publish a compensation object, and a figure the
 * company entered into a field marked "salary" beats one recognised in prose.
 * Extraction still runs for everything else, and still runs for these Postings
 * when the field is empty — which is the common case.
 *
 * Refusals, all for the same reason the prose extractor refuses: a wrong number
 * is worse than no number, and no number always passes a floor (CONTEXT.md,
 * "Criteria"). Non-dollar pay is not read, because the floor a User states is
 * in dollars and nothing here converts currencies. A period this does not
 * recognise is not read. A single bound stands for both, which is what a
 * Posting stating only a minimum means.
 */
export function statedSalary(pay: StatedPay): ExtractedSalary | null {
  if (pay.currency?.toUpperCase() !== "USD") return null;
  if (!pay.period) return null;

  const stated = [amount(pay.min), amount(pay.max)].filter(
    (value): value is number => value !== null,
  );
  if (stated.length === 0) return null;

  // Pay stated per month is annualised here, so nothing downstream needs a
  // third unit — the same collapse salary Extraction makes.
  const period: SalaryPeriod = pay.period === "month" ? "year" : pay.period;
  const factor = pay.period === "month" ? MONTHS_PER_YEAR : 1;

  return {
    min: Math.min(...stated) * factor,
    max: Math.max(...stated) * factor,
    period,
  };
}

/** A figure a Source stated as a number or as a string of one, if it is one. */
function amount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A Slug safe to put in a hostname.
 *
 * Recruitee addresses a Board by subdomain rather than by path, so its Slug is
 * part of the host and `encodeURIComponent` does not contain it: a Slug
 * carrying a `/` or a `.` would point the request at a different server
 * entirely. Discovery probes Slugs harvested from the open web (#18), so this
 * is not a hypothetical input. A DNS label is letters, digits, and hyphens, and
 * anything else is refused before a request is made.
 */
export function hostnameLabel(label: string, slug: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(slug)) {
    throw new Error(
      `${label} Board "${slug}" is not a Slug this Source can address`,
    );
  }
  return slug.toLowerCase();
}
