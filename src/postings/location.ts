/**
 * Location normalization: turning a Posting's free-text location into a stable
 * key a geocoder can read, or null when the text names no place (#12).
 *
 * A pure function with no I/O, tested directly (`location.test.ts`). Geocoding
 * is cached by what this returns rather than per Posting, because the same
 * handful of strings — `Greater Boston Area`, `San Francisco, CA` — recur across
 * thousands of Postings. After a short warm-up this is close to zero external
 * calls.
 *
 * The contract that matters: when the text names no geocodable place, the answer
 * is null. A remote-only string (`Remote`, `Fully remote`), a placeholder
 * (`Multiple locations`, `Various`), or empty text all normalize to null, so the
 * geocoder is never called on a string that would only fail.
 */

/**
 * Arrangement words a Source prefixes a location with — `Hybrid - London`,
 * `Remote - US`. Stripped so the place is what gets geocoded; a string that is
 * only one of these normalizes to null.
 */
const LEADING_ARRANGEMENT_RE =
  /^(?:fully\s+)?(?:remote|hybrid|on-?site|in[-\s]person|in[-\s]office)\b[\s:/,-]*/i;

/**
 * A remote alternative tacked onto a real place — `San Francisco, CA / Remote`,
 * `Austin, TX (Remote)`, `Boston, MA or Remote`. Stripped from the end, keeping
 * the place.
 */
const TRAILING_REMOTE_RE =
  /[\s(/,-]+(?:or\s+)?(?:fully\s+)?remote\)?\s*$/i;

/** A parenthetical aside — `(3 days in office)` — carries no place. */
const PARENTHETICAL_RE = /\s*\([^)]*\)/g;

/**
 * Strings that name no single place a geocoder could resolve to a point:
 * remote-role markers and placeholders alike. Held as a set so one costs no
 * external call — it normalizes straight to null.
 */
const NOT_A_PLACE = new Set([
  "remote",
  "fully remote",
  "remote - anywhere",
  "anywhere",
  "work from home",
  "worldwide",
  "global",
  "flexible",
  "various",
  "various locations",
  "multiple",
  "multiple locations",
  "n/a",
  "tbd",
  "unknown",
]);

/**
 * The geocoding key for a Posting's location, or null when it names no place.
 *
 * Lowercased and whitespace-collapsed so `San Francisco,  CA` and
 * `San Francisco, CA` share one cache entry; arrangement labels and remote
 * alternatives are stripped so what a geocoder sees is the place alone.
 */
export function normalizeLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let value = raw
    .replace(PARENTHETICAL_RE, "")
    .replace(LEADING_ARRANGEMENT_RE, "")
    .replace(TRAILING_REMOTE_RE, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s,/-]+|[\s,/-]+$/g, "")
    .trim();

  // Collapse the whitespace left where a comma now has nothing after it.
  value = value.replace(/\s*,\s*(?=,|$)/g, "").trim();

  if (!value || NOT_A_PLACE.has(value)) return null;
  return value;
}
