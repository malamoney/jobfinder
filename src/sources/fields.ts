import type { ExtractedSalary, SalaryPeriod } from "@/postings/salary";
import type { SourcePosting } from "./types";

/**
 * What a Source published, turned into the fields a Posting holds.
 *
 * Pure functions, no network: `./adapter` does the asking, and everything here
 * works on what came back. They live together because the Sources disagree
 * about spelling far more than about meaning — five ways to write a date, three
 * ways to say "remote", four shapes for a salary — and one answer to each keeps
 * five adapters from each inventing their own.
 */

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

/**
 * An Arrangement as a location string spells it.
 *
 * The same three values CONTEXT.md defines under Arrangement — remote, onsite,
 * hybrid — in the capitalised form a location string carries them in. Only the
 * location half of Arrangement: the employment half (full-time, part-time) is
 * never part of a place.
 */
export type ArrangementLabel = "Remote" | "Hybrid" | "Onsite";

/**
 * The Arrangement a Source's own workplace field names, or null where it names
 * none this understands.
 *
 * Four of the five Sources publish this as a field of its own, and they spell
 * it four ways — `remote`, `Remote`, `OnSite`, `on_site` — so separators and
 * case are flattened before the comparison. A value nobody here recognises
 * (Lever's `unspecified`, or one added tomorrow) is null rather than a guess.
 */
export function arrangementLabel(
  value: string | null | undefined,
): ArrangementLabel | null {
  switch (value?.toLowerCase().replace(/[-_\s]/g, "")) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "onsite":
      return "Onsite";
    default:
      return null;
  }
}

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
export function placeWithArrangement(
  arrangement: ArrangementLabel | null,
  place: string | null | undefined,
): string | null {
  const named = place?.trim() || null;
  if (!arrangement) return named;
  if (!named) return arrangement;
  return new RegExp(`^${arrangement}\\b`, "i").test(named)
    ? named
    : `${arrangement} - ${named}`;
}

/**
 * Every place a Posting names, as one location string.
 *
 * Three of the Sources say more than one place per job — Workable publishes the
 * job once per location, Lever lists them in `allLocations`, Ashby adds
 * `secondaryLocations` — and all of them have to fit the one field the Corpus
 * holds. Joined with ` / `, the separator Greenhouse Boards already use for
 * `San Francisco, CA / Remote`, with duplicates dropped and order kept so the
 * Source's primary place reads first.
 *
 * Keeping only the first would be the silent failure: a role open in Atlanta
 * and in Florida would quietly stop existing for everyone outside Atlanta, and
 * they would never find out. All of them named means the string may not
 * geocode, and a Posting that does not geocode is surfaced as an unresolved
 * location rather than dropped (CONTEXT.md, "Unresolved location") — visible,
 * which is the failure worth having.
 */
export function everyPlace(
  places: Array<string | null | undefined>,
): string | null {
  const named = [
    ...new Set(
      places
        .map((place) => place?.trim())
        .filter((place): place is string => Boolean(place)),
    ),
  ];
  return named.length === 0 ? null : named.join(" / ");
}

/**
 * The pay period a Source's own word for it names, or null where it names none
 * this understands.
 *
 * The structured-pay counterpart to `arrangementLabel`: the ATS Sources publish
 * a period key `statedSalary` maps directly (`per-year-salary`), but the
 * aggregators (#15) write an English word — Himalayas `annual`, USAJOBS `Per
 * Year` off its `RateIntervalCode` — and they spell it more than one way. A
 * word nobody here recognises is null rather than a guess, which is what leaves
 * the figure to prose Extraction.
 */
export function salaryPeriodFromWords(
  value: string | null | undefined,
): "year" | "month" | "hour" | null {
  switch (value?.toLowerCase().replace(/[-_\s]/g, "").replace(/ly$/, "")) {
    case "year":
    case "annual":
    case "annum":
    case "peryear":
    case "perannum":
      return "year";
    case "month":
    case "permonth":
      return "month";
    case "hour":
    case "perhour":
      return "hour";
    default:
      return null;
  }
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
 * One `SourcePosting` per Source Key, keeping the last.
 *
 * An aggregator pages through a feed (#15), and a feed that shifts a result
 * across a page boundary while the Fetch is walking it — a new posting arrives
 * at the top of a newest-first feed between two requests — hands the adapter
 * the same job twice. The Corpus upserts on `(source, source_id)` in one
 * statement, and Postgres refuses an insert that would touch one row twice, so
 * an undeduped repeat fails the whole Fetch. This is the aggregator's version
 * of what `collapseByShortcode` does for Workable; there is nothing to merge
 * across the copies, so the later one simply wins.
 */
export function oneSourcePostingPerId(
  postings: SourcePosting[],
): SourcePosting[] {
  return [
    ...new Map(postings.map((posting) => [posting.sourceId, posting])).values(),
  ];
}

/** Days after a Fetch last saw it that an aggregator Posting with no published
 * close date is taken to have expired. */
const UNDATED_EXPIRY_DAYS = 60;

/**
 * The close date to store for an aggregator Posting: the one the feed
 * published, or a sliding fallback when it published none.
 *
 * An aggregator Posting never expires by absence (`reconcileBoard` skips
 * `countAbsences` for it, ADR 0007), so a null close date would leave it live
 * in the Corpus forever — a filled role no path ever retires. The fallback is
 * measured from now, so every Fetch that still returns the Posting slides it
 * forward: it stays live while it keeps appearing in the feed's newest pages,
 * and expires `UNDATED_EXPIRY_DAYS` after it drops out of them.
 */
export function feedCloseDate(published: Date | null): Date {
  if (published) return published;
  return new Date(Date.now() + UNDATED_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
