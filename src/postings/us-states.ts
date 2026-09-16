/**
 * The US states: the fifty and the District of Columbia, each by its USPS code
 * (`Austin, TX`) and by the name a location line spells out (`Austin, Texas`).
 *
 * Owned here rather than inside one reader because more than one needs it. The
 * country classifier (`country.ts`) reads a code after a comma, or a name
 * anywhere, as a US signal; the location normalizer (`location.ts`) reads a
 * period after a code as the end of a place in a list — `Fort Wayne, IN.
 * Mooresville, IN.` — which is the one thing that tells that period from the
 * one in `St. Louis, MO` (#120), and reads a state standing as the whole of a
 * place — `Remote - Massachusetts`, `Remote - MA` — as no Place at all (#146).
 * A US-only Corpus (ADR 0010) is entitled to know its own states, and two
 * readers should not each keep a list.
 *
 * Deliberately the states alone, and deliberately not the territories: `PR`,
 * `GU` and `VI` would widen what the country classifier calls `us`, which is a
 * decision for a ticket that wants it, not a side effect of moving a list. The
 * classifier keeps the two territory names it always matched beside these.
 * Both readers match the codes case-sensitively where a code sits after a
 * comma — a state code is written `MA`, and a lowercase `ma` after a comma is
 * as likely to be prose.
 */
export const US_STATES: readonly (readonly [code: string, name: string])[] = [
  ["AL", "alabama"],
  ["AK", "alaska"],
  ["AZ", "arizona"],
  ["AR", "arkansas"],
  ["CA", "california"],
  ["CO", "colorado"],
  ["CT", "connecticut"],
  ["DC", "district of columbia"],
  ["DE", "delaware"],
  ["FL", "florida"],
  ["GA", "georgia"],
  ["HI", "hawaii"],
  ["IA", "iowa"],
  ["ID", "idaho"],
  ["IL", "illinois"],
  ["IN", "indiana"],
  ["KS", "kansas"],
  ["KY", "kentucky"],
  ["LA", "louisiana"],
  ["MA", "massachusetts"],
  ["MD", "maryland"],
  ["ME", "maine"],
  ["MI", "michigan"],
  ["MN", "minnesota"],
  ["MO", "missouri"],
  ["MS", "mississippi"],
  ["MT", "montana"],
  ["NC", "north carolina"],
  ["ND", "north dakota"],
  ["NE", "nebraska"],
  ["NH", "new hampshire"],
  ["NJ", "new jersey"],
  ["NM", "new mexico"],
  ["NV", "nevada"],
  ["NY", "new york"],
  ["OH", "ohio"],
  ["OK", "oklahoma"],
  ["OR", "oregon"],
  ["PA", "pennsylvania"],
  ["RI", "rhode island"],
  ["SC", "south carolina"],
  ["SD", "south dakota"],
  ["TN", "tennessee"],
  ["TX", "texas"],
  ["UT", "utah"],
  ["VA", "virginia"],
  ["VT", "vermont"],
  ["WA", "washington"],
  ["WI", "wisconsin"],
  ["WV", "west virginia"],
  ["WY", "wyoming"],
] as const;

/**
 * The table above, as a location line writes the two halves of it: the USPS
 * codes in capitals (`TX`), and the names lowercased (`texas`).
 */
const US_STATE_CODES: readonly string[] = US_STATES.map(([code]) => code);

/** The state names, lowercased, as a location line spells one out. */
export const US_STATE_NAMES: readonly string[] = US_STATES.map(([, name]) => name);

/**
 * The codes as a regex alternation, `(?:AL|AK|…)`, with no capture of its own,
 * so the caller decides what surrounds it and whether anything is captured.
 */
export const US_STATE_CODE_ALTERNATION = `(?:${US_STATE_CODES.join("|")})`;
