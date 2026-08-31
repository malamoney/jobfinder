/**
 * Country Extraction: deciding whether a Posting is based in the United States
 * from its location text (#feature: "United States only" Criteria).
 *
 * A pure function, tested directly (`country.test.ts`). It runs in the matching
 * funnel over the Postings a User's cheap stages let through, the same as
 * `extractArrangements` and `normalizeLocation`, and against the location
 * string alone — a country named in a description is where a company is, not
 * where the role is.
 *
 * No Source publishes a country field, and the strings are as messy as every
 * other location signal — `San Francisco, CA`, `Remote - US`, `London, UK`,
 * `Remote`. So the answer is one of three:
 *
 * - `us` — a US state (named or abbreviated), an explicit US marker, or a
 *   "remote, US" phrasing.
 * - `non-us` — a country or region that is not the US, and no US signal beside
 *   it.
 * - `unknown` — nothing either way, most often a bare `Remote`.
 *
 * The "United States only" filter keeps `us` and drops the other two: a User
 * who asks for US-only roles is asking to be shown nothing they cannot place,
 * not just the ones placed abroad (ADR 0009).
 */

/** Whether a Posting is based in the United States, as far as its text says. */
export type Country = "us" | "non-us" | "unknown";

/** The fifty states, DC, and the territories with their own USPS codes, by name. */
const US_STATE_NAMES = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "district of columbia",
  "puerto rico",
  "guam",
];

const US_STATE_NAME_RE = new RegExp(
  `\\b(${US_STATE_NAMES.join("|").replace(/ /g, "\\s")})\\b`,
  "i",
);

/**
 * A USPS state code straight after a comma (`Austin, TX`). Case-sensitive and
 * uppercase-only on purpose: a state code is written `MA`, and `,\s*ma\b` would
 * also fire on "…, matching the brief" and "…, in office" and "…, or remote".
 * `CA` here is California; Canada (`, ON` etc., and the word itself) is ruled
 * out first.
 */
const US_STATE_ABBR_RE =
  /,\s*(A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;

/** A Canadian province or territory code, same shape as the US one. */
const CA_PROVINCE_ABBR_RE = /,\s*(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;

/** A location string that is *only* a name for the country. */
const BARE_US_RE = /^(u\.?\s?s\.?|u\.?\s?s\.?\s?a\.?|usa|united states(?:\s+of\s+america)?)\.?$/i;

/** An explicit "this role is in the US" phrasing, remote ones included. */
const US_MARKER_RE =
  /\b(u\.?\s?s\.?\s?a\.?|united states(?:\s+of\s+america)?|remote[\s,()-]*(?:us\b|u\.s\.|usa|united states)|(?:us|u\.s\.|usa|united states)[\s,()-]*(?:remote|based|only))\b|,\s*d\.?\s?c\.?\b/i;

/**
 * A country or region that is not the United States. Canada leads, because its
 * `CA` code collides with California's; the rest are the countries and regional
 * groupings a remote-role location line actually names.
 */
const NON_US_RE =
  /\b(canada|united kingdom|u\.?k\.?|great britain|england|scotland|wales|northern ireland|ireland|germany|deutschland|france|spain|españa|italy|italia|netherlands|belgium|luxembourg|switzerland|austria|portugal|poland|czech(?:ia| republic)?|slovakia|hungary|romania|bulgaria|greece|sweden|norway|denmark|finland|iceland|estonia|latvia|lithuania|india|pakistan|bangladesh|china|hong kong|taiwan|japan|south korea|singapore|malaysia|indonesia|thailand|vietnam|philippines|australia|new zealand|brazil|brasil|argentina|chile|colombia|peru|mexico|méxico|south africa|nigeria|kenya|egypt|israel|turkey|türkiye|ukraine|russia|uae|united arab emirates|saudi arabia|qatar|emea|apac|latam|anz|\beu\b|european union|eea)\b/i;

/**
 * Where a Posting is based, from its location text.
 *
 * Order matters. An explicit US signal — the bare country name, a "remote, US"
 * phrasing, a spelled-out state — wins first, so a role open across the US and
 * abroad ("Remote - US or Canada") still counts as US. Then a non-US country or
 * a Canadian province code, which also settles the `CA` (California / Canada)
 * ambiguity. Then a US state code. Then nothing.
 */
export function extractCountry(location: string | null | undefined): Country {
  const text = (location ?? "").trim();
  if (!text) return "unknown";

  if (BARE_US_RE.test(text)) return "us";
  if (US_MARKER_RE.test(text) || US_STATE_NAME_RE.test(text)) return "us";

  if (
    /\bcanada\b/i.test(text) ||
    CA_PROVINCE_ABBR_RE.test(text) ||
    NON_US_RE.test(text)
  ) {
    return "non-us";
  }

  if (US_STATE_ABBR_RE.test(text)) return "us";

  return "unknown";
}
