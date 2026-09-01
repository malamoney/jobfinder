/**
 * Country classification: deciding whether a Posting is based in the United
 * States from its location text (ADR 0010, superseding ADR 0009).
 *
 * A pure function, tested directly (`country.test.ts`). It runs on ingestion,
 * over the location string alone — `reconcileBoard` stores only the roles it
 * calls `us` — and again in Extraction, which re-derives the same value
 * idempotently. A country named in a description is where a company is, not
 * where the role is, so only the location string is read.
 *
 * No Source publishes a country field, and the strings are as messy as every
 * other location signal — `San Francisco, CA`, `Remote - US`, `London, UK`,
 * `Berlin, DE`, `Bangalore, IN`, `Remote`. So the answer is one of three:
 *
 * - `us` — a US state (named or abbreviated), an explicit US marker, or a
 *   "remote, US" phrasing.
 * - `non-us` — a country or region that is not the US, spelled out or as an ISO
 *   code, and no US signal beside it. A code that doubles as a USPS state code
 *   (`CA`, `DE`, `IN`, …) counts only next to a known metro of that country.
 * - `unknown` — nothing either way, most often a bare `Remote`.
 *
 * The Corpus keeps `us` and drops the other two: `unknown` is overwhelmingly a
 * bare `Remote`, and a Corpus meant to hold only US roles has no more use for
 * "might be American" than for "definitely abroad" (ADR 0010).
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

/**
 * An ISO 3166-1 alpha-2 country code straight after a comma (`Amsterdam, NL`,
 * `Tokyo, JP`) — the shape an ATS Board's location line takes as often as it
 * spells the country out.
 *
 * Case-sensitive and uppercase-only, exactly like `US_STATE_ABBR_RE` and for
 * the same reason: `,\s*is` would fire on "…, is remote", `,\s*it` on "…, IT
 * support". A country code in a location line is written `IT`, `NL`, `JP`.
 *
 * Only codes that are *not* also a USPS state code are here. The ambiguous ones
 * — `CA`, `DE`, `IN`, `CO`, `AR`, `IL`, `GA`, `LA`, `MD`, `ME`, `PA` — are left
 * to `NON_US_METROS`, because `San Francisco, CA` is not Canada.
 */
const NON_US_COUNTRY_ABBR_RE =
  /,\s*(GB|IE|FR|ES|PT|IT|NL|BE|LU|CH|AT|DK|SE|NO|FI|IS|PL|CZ|SK|HU|RO|BG|GR|HR|SI|EE|LV|LT|UA|RU|TR|BR|MX|CL|PE|UY|EC|BO|PY|VE|CR|GT|DO|ZA|KE|EG|NG|DZ|GH|AE|QA|KW|BH|OM|SA|JO|LB|SG|HK|TW|JP|KR|CN|PH|TH|VN|MY|MM|KH|LK|NP|BD|PK|AU|NZ|FJ)\b/;

/**
 * Well-known metros of the countries whose ISO code collides with a USPS state
 * code, so `Toronto, CA` reads as Canada while `Sacramento, CA` stays US. Keyed
 * by the colliding code, lower-case; matched as a whole word before that code.
 *
 * Deliberately not a gazetteer — just the handful of cities that actually show
 * up on remote job listings. A city not on the list keeps the US reading of its
 * code (ADR 0010's rule: never silently drop a role that might be American).
 */
const NON_US_METROS: Record<string, readonly string[]> = {
  ca: [
    "toronto",
    "vancouver",
    "montreal",
    "montréal",
    "calgary",
    "ottawa",
    "edmonton",
    "winnipeg",
    "halifax",
    "waterloo",
    "kitchener",
    "mississauga",
    "brampton",
    "markham",
    "burnaby",
    "saskatoon",
    "regina",
    "quebec city",
    "québec city",
  ],
  de: [
    "berlin",
    "munich",
    "münchen",
    "muenchen",
    "hamburg",
    "frankfurt",
    "cologne",
    "köln",
    "koeln",
    "düsseldorf",
    "dusseldorf",
    "stuttgart",
    "leipzig",
    "dortmund",
    "dresden",
    "hannover",
    "hanover",
    "nuremberg",
    "nürnberg",
  ],
  in: [
    "bangalore",
    "bengaluru",
    "mumbai",
    "delhi",
    "new delhi",
    "hyderabad",
    "pune",
    "chennai",
    "kolkata",
    "gurgaon",
    "gurugram",
    "noida",
    "ahmedabad",
    "chandigarh",
    "jaipur",
    "kochi",
    "coimbatore",
    "indore",
    "thiruvananthapuram",
  ],
  co: ["bogota", "bogotá", "medellin", "medellín", "cali", "barranquilla"],
  ar: ["buenos aires", "córdoba", "rosario", "mendoza"],
  il: ["tel aviv", "tel aviv-yafo", "jerusalem", "haifa", "herzliya", "ramat gan"],
  pa: ["panama city", "ciudad de panamá"],
};

/**
 * Whether the location names a known non-US metro beside its country code — the
 * disambiguation for a code that is both an ISO country and a USPS state.
 */
function namesNonUsMetro(text: string): boolean {
  for (const [code, cities] of Object.entries(NON_US_METROS)) {
    // Uppercase-only on the code, like every other abbreviation here; the city
    // match stays case-insensitive because a place name is written many ways.
    if (!new RegExp(`,\\s*${code.toUpperCase()}\\b`).test(text)) continue;
    if (cities.some((city) => cityBoundary(city).test(text))) return true;
  }
  return false;
}

/**
 * A whole-word matcher for a city name. `\b` cannot bound a name that ends in an
 * accented letter (`Bogotá`, `Montréal`) — under the default flags `á` is not a
 * word character — so this bounds on the Unicode letter class instead.
 */
function cityBoundary(city: string): RegExp {
  const pattern = city
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, "iu");
}

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
 * abroad ("Remote - US or Canada") still counts as US. Then a non-US country,
 * spelled out or as an ISO code, or a Canadian province code — which also
 * settles the `CA` (California / Canada) ambiguity, together with the known
 * non-US metros for the other codes that double as a USPS state. Then a US
 * state code. Then nothing.
 */
export function extractCountry(location: string | null | undefined): Country {
  const text = (location ?? "").trim();
  if (!text) return "unknown";

  if (BARE_US_RE.test(text)) return "us";
  if (US_MARKER_RE.test(text) || US_STATE_NAME_RE.test(text)) return "us";

  if (
    /\bcanada\b/i.test(text) ||
    CA_PROVINCE_ABBR_RE.test(text) ||
    NON_US_RE.test(text) ||
    NON_US_COUNTRY_ABBR_RE.test(text) ||
    namesNonUsMetro(text)
  ) {
    return "non-us";
  }

  if (US_STATE_ABBR_RE.test(text)) return "us";

  return "unknown";
}
