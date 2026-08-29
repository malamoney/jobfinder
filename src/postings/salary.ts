/**
 * Salary Extraction: pulling the pay a Posting mentions in prose into two
 * figures and a unit, so the minimum-salary funnel stage has something to
 * compare against (#11).
 *
 * A pure function with no I/O, tested directly across the many ways a Board
 * states pay (`salary.test.ts`) rather than by driving Fetches.
 *
 * The contract that matters: when the text does not *state* a salary, the
 * answer is `null`. "Unknown is not zero" (CONTEXT.md, "Criteria") — a Posting
 * that never mentions pay must pass every floor, and it can only do that if
 * this refuses to guess a number for it. Everything here is biased towards that
 * refusal: an amount is read as pay only when the text marks it as pay, or when
 * a dollar-prefixed figure is large enough that nothing else it could be makes
 * sense.
 *
 * Only dollar figures are read. A "£90,000" is left unknown rather than
 * compared to a floor stated in dollars — a wrong currency is worse than no
 * number.
 */

/** Full-time hours in a year (40 × 52), the factor that annualises a rate. */
export const WORKING_HOURS_PER_YEAR = 2080;

/** The unit a Posting expresses pay in. */
export type SalaryPeriod = "year" | "hour";

/** A salary as a Posting's text stated it. */
export type ExtractedSalary = {
  /** The lower figure, in the stated unit; equal to `max` for a single value. */
  min: number;
  /** The upper figure, in the stated unit. */
  max: number;
  /** The unit `min` and `max` are in. */
  period: SalaryPeriod;
};

/**
 * The annual value of a figure stated in `period`. An hourly rate is multiplied
 * out; a yearly figure is already annual. One place for the factor, so a
 * stored salary and the funnel that filters on it cannot disagree about it.
 */
export function annualise(amount: number, period: SalaryPeriod): number {
  return period === "hour" ? amount * WORKING_HOURS_PER_YEAR : amount;
}

/** What a plausible salary sits between once annualised, whatever the unit. */
const MIN_ANNUAL = 10_000;
const MAX_ANNUAL = 5_000_000;
/** Above this an hourly "rate" is a misread figure, not pay. */
const MAX_HOURLY_RATE = 2_000;

/** How far to either side of a figure its classifying context is read. */
const CONTEXT_BEFORE = 48;
const CONTEXT_AFTER = 32;

const CURRENCY = String.raw`(?:US\$|USD|\$)`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
/** An optional per-unit that can sit between a figure and a range separator. */
const UNIT = String.raw`(?:\s*(?:\/\s*[A-Za-z]+|per\s+[A-Za-z]+|[A-Za-z]+ly))?`;
const SEPARATOR = String.raw`\s*(?:-|to)\s*`;

const RANGE_RE = new RegExp(
  `${CURRENCY}?\\s*(${NUMBER})\\s*([kK])?${UNIT}${SEPARATOR}${CURRENCY}?\\s*(${NUMBER})\\s*([kK])?`,
  "g",
);
const SINGLE_RE = new RegExp(`(${CURRENCY})\\s*(${NUMBER})\\s*([kK])?`, "g");
/**
 * A figure with no currency symbol but a k-suffix or an explicit pay unit —
 * "150k", "180,000 per year", "$"-less "72 per hour". A bare number with none
 * of those is never read as pay.
 */
const BARE_RE = new RegExp(
  `\\b(${NUMBER})\\s*([kK])?\\s*(\\/\\s*(?:yr|year|hr|hour|mo|month)\\b|per\\s+(?:year|hour|month)\\b|annually|hourly|monthly)?`,
  "gi",
);
const HAS_CURRENCY_RE = new RegExp(CURRENCY);

/** Markers that name an amount as pay, so an unmarked magnitude is not a guess. */
const PAY_MARKER_RE =
  /\b(salar(?:y|ies)|compensation|\bcomp\b|base\s+pay|pay\s+(?:range|rate|band)|hourly\s+rate|wage|remuneration|\bote\b|on-target\s+earnings|earn(?:s|ing|ings)?)\b/i;

/** Contexts where a dollar figure is something other than pay. */
const NOT_PAY_RE =
  /\b(bonus|sign-?on|stipend|budget|allowance|relocation|reimburs|equity|401\s*\(?k|match|per diem|credit|discount|stock|rsu|grant|fund(?:ing|ed|s)?|raised|valuation|revenue|arr\b)\b/i;

const PER_HOUR_RE = /(?:\/\s*h(?:r|our)?\b|per\s+hour|an?\s+hour|hourly)/i;
const PER_MONTH_RE = /(?:\/\s*(?:mo|month)\b|per\s+month|monthly|a\s+month)/i;
const PER_YEAR_RE =
  /(?:\/\s*(?:yr|year|annum)\b|per\s+(?:year|annum)|per\s+annum|annually|annualized|annualised|\bp\.?a\.?\b)/i;
/** Months in a year, for annualising pay stated per month. */
const MONTHS_PER_YEAR = 12;

/**
 * The salary a Posting's text states, or `null` when it states none.
 *
 * A range is preferred over a single figure, and the first plausible match
 * wins — a description that lists a home-office budget and then a salary band
 * yields the band, because the budget figure is never marked as pay and is too
 * small to be read as one.
 */
export function extractSalary(text: string): ExtractedSalary | null {
  if (!text) return null;

  // One dash character to match against, and non-breaking spaces made ordinary.
  const normalized = text
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u00a0/g, " ");

  return (
    firstRange(normalized) ??
    firstSingle(normalized) ??
    firstBare(normalized)
  );
}

/** The first two-bound range in the text that reads as a salary. */
function firstRange(text: string): ExtractedSalary | null {
  RANGE_RE.lastIndex = 0;
  for (let match = RANGE_RE.exec(text); match; match = RANGE_RE.exec(text)) {
    const [whole, lowDigits, lowK, highDigits, highK] = match;
    if (precededByForeignCurrency(text, match.index)) continue;
    const kSuffix = Boolean(lowK ?? highK);

    let low = toNumber(lowDigits, lowK);
    let high = toNumber(highDigits, highK);
    // "$90k - $120k" states the suffix once; a bare second figure smaller than
    // a range otherwise in thousands is in the same unit.
    if (kSuffix && !lowK && low < 1000) low *= 1000;
    if (kSuffix && !highK && high < 1000) high *= 1000;
    if (high < low) [low, high] = [high, low];

    const salary = classify(low, high, whole, contextAround(text, match));
    if (salary) return salary;
  }
  return null;
}

/** The first dollar-prefixed single figure in the text that reads as a salary. */
function firstSingle(text: string): ExtractedSalary | null {
  SINGLE_RE.lastIndex = 0;
  for (let match = SINGLE_RE.exec(text); match; match = SINGLE_RE.exec(text)) {
    const [whole, , digits, k] = match;
    const value = toNumber(digits, k);
    const salary = classify(value, value, whole, contextAround(text, match));
    if (salary) return salary;
  }
  return null;
}

/**
 * The first currency-less figure in the text that carries a k-suffix or a pay
 * unit and reads as a salary — "150k", "180,000 per year".
 */
function firstBare(text: string): ExtractedSalary | null {
  BARE_RE.lastIndex = 0;
  for (let match = BARE_RE.exec(text); match; match = BARE_RE.exec(text)) {
    const [whole, digits, k, unit] = match;
    if (!k && !unit) continue;
    if (precededByForeignCurrency(text, match.index)) continue;

    const value = toNumber(digits, k);
    const salary = classify(value, value, whole, contextAround(text, match));
    if (salary) return salary;
  }
  return null;
}

/** Currency symbols that are not dollars — a figure behind one is not read. */
const FOREIGN_CURRENCY_RE = /[£€¥₹₩]\s?$/;

/** Whether the text just before `index` marks the figure as a non-dollar one. */
function precededByForeignCurrency(text: string, index: number): boolean {
  return FOREIGN_CURRENCY_RE.test(text.slice(Math.max(0, index - 2), index));
}

/** The text on either side of a match, for deciding what the figure is. */
function contextAround(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - CONTEXT_BEFORE);
  const end = match.index + match[0].length + CONTEXT_AFTER;
  return text.slice(start, end);
}

/**
 * Decides whether a figure (or pair of figures) is a salary, and in what unit,
 * or returns `null` to leave it be.
 *
 * An explicit per-unit ("/hr", "per year") settles it. A k-suffix means annual.
 * Failing those, a dollar-prefixed figure large enough to be a yearly salary is
 * taken as one — unless its surroundings name it as a bonus, a budget, or
 * funding, and nothing names it as pay.
 */
function classify(
  low: number,
  high: number,
  matched: string,
  context: string,
): ExtractedSalary | null {
  const hasCurrency = HAS_CURRENCY_RE.test(matched);
  const kSuffix = /[kK]/.test(matched);

  let period: SalaryPeriod | null = null;
  let monthly = false;
  if (PER_HOUR_RE.test(context)) period = "hour";
  else if (PER_MONTH_RE.test(context)) {
    monthly = true;
    period = "year";
  } else if (kSuffix || PER_YEAR_RE.test(context)) period = "year";
  else if (hasCurrency && high >= 1000) {
    if (!PAY_MARKER_RE.test(context) && NOT_PAY_RE.test(context)) return null;
    period = "year";
  }
  if (!period) return null;

  // Pay stated per month is annualised to a yearly figure here, so nothing
  // downstream needs a third unit.
  const min = monthly ? low * MONTHS_PER_YEAR : low;
  const max = monthly ? high * MONTHS_PER_YEAR : high;

  if (annualise(min, period) < MIN_ANNUAL) return null;
  if (annualise(max, period) > MAX_ANNUAL) return null;
  if (period === "hour" && max > MAX_HOURLY_RATE) return null;

  return { min, max, period };
}

/** A digit run, with commas dropped and an optional k-suffix applied. */
function toNumber(digits: string, k: string | undefined): number {
  const value = Number.parseFloat(digits.replace(/,/g, ""));
  return k ? value * 1000 : value;
}
