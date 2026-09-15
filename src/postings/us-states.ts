/**
 * The USPS state codes: the fifty states and the District of Columbia, as a
 * location line abbreviates them (`Austin, TX`).
 *
 * Owned here rather than inside one reader because two of them need it (#120).
 * The country classifier (`country.ts`) reads a code after a comma as a US
 * signal; the location normalizer (`location.ts`) reads a period after one as
 * the end of a place in a list — `Fort Wayne, IN. Mooresville, IN.` — which is
 * the one thing that tells that period from the one in `St. Louis, MO`. A
 * US-only Corpus (ADR 0010) is entitled to know its own states.
 *
 * Deliberately the codes alone, and deliberately not the territories: `PR`,
 * `GU` and `VI` would widen what the country classifier calls `us`, which is a
 * decision for a ticket that wants it, not a side effect of moving a list.
 * Both readers match these case-sensitively — a state code is written `MA`,
 * and a lowercase `ma` after a comma is as likely to be prose.
 */
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI",
  "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN",
  "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA",
  "WI", "WV", "WY",
] as const;

/**
 * The table as both readers consume it: one regex alternation, `(?:AL|AK|…)`,
 * with no capture of its own, so the caller decides what surrounds it and
 * whether anything is captured.
 */
export const US_STATE_CODE_ALTERNATION = `(?:${US_STATE_CODES.join("|")})`;
