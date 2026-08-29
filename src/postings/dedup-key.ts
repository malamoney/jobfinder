import { normalizeLocation } from "./location";

/**
 * The Dedup Key: a Posting's approximate identity across Sources (#13).
 *
 * A pure function with no I/O, tested directly (`dedup-key.test.ts`) — one of
 * the secondary-seam normalizers the spec (#2) allows a lower seam for, next to
 * salary Extraction and haversine distance.
 *
 * Two Postings sharing a Dedup Key are the same opening published in more than
 * one place. Grouping is deliberately cheap and deterministic: the same three
 * fields (#2) — company, title, location — lowercased and stripped of
 * punctuation, plus a fixed list of trailing company legal forms (`Inc`, `Ltd`,
 * …) removed so `Stripe, Inc.` and `Stripe` group. Nothing fuzzy: a fixed
 * list, anchored to the end, no distance metric, no model. A company that
 * writes its name two other ways, or a title that differs by a word, still
 * produces two keys and two groups — the accepted cost of a rule this blunt
 * (ADR 0006).
 *
 * The location component is run through `normalizeLocation` — the same
 * normalization the geocode cache is keyed by (#12) — so a listing that says
 * `San Francisco, CA` and one that says `San Francisco, CA / Remote` land in
 * one group, and every remote or place-less listing contributes the same empty
 * component.
 */

/**
 * Separates the three components in the key: a control character that never
 * occurs in a company name, title, or location, so `acme inc` + `staff` and
 * `acme` + `inc staff` key differently rather than colliding on a shared space.
 */
const FIELD_SEPARATOR = "";

/**
 * A field flattened for comparison: accents folded away (`Zürich` → `zurich`),
 * case folded, and every run of punctuation or whitespace collapsed to one
 * space. `Staff Engineer, Backend` and `Staff Engineer - Backend` both become
 * `staff engineer backend`.
 */
function normalizeField(value: string): string {
  return value
    .normalize("NFKD")
    // Drop the combining marks NFKD split off, so `Zürich` folds to `zurich`
    // rather than breaking at the mark into `zu rich`.
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Legal-form suffixes a company appends on one Source and omits on another —
 * `Acme, Inc.` on Greenhouse, `Acme` on Lever. Stripped from the end of the
 * normalized company so the two group together.
 *
 * Deliberately short: only forms that are unmistakably a legal suffix as a
 * trailing token. Two-letter national forms (`AG`, `SA`, `AS`, `AB`, `NV`, …)
 * are left in — as a bare final word they collide with ordinary names too
 * easily for the benefit they buy.
 */
const LEGAL_FORM_RE =
  /\s+(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|llp)$/;

/** The company component: flattened, then stripped of a trailing legal form. */
function normalizeCompany(value: string): string {
  let company = normalizeField(value);
  // Twice, so `Acme Company, Inc` sheds both tokens.
  company = company.replace(LEGAL_FORM_RE, "").replace(LEGAL_FORM_RE, "");
  return company.trim();
}

/**
 * The Dedup Key for a Posting's company, title, and location.
 *
 * Accepts anything with those three fields — a `SourcePosting` on the way into
 * the Corpus, or a stored `Posting` — so the key written on ingestion and any
 * key derived later cannot drift.
 */
export function dedupKey(parts: {
  company: string;
  title: string;
  location: string | null | undefined;
}): string {
  return [
    normalizeCompany(parts.company),
    normalizeField(parts.title),
    normalizeLocation(parts.location) ?? "",
  ].join(FIELD_SEPARATOR);
}
