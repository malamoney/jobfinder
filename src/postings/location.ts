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
 *
 * An employer may name several places at once — `San Francisco Bay Area, CA /
 * Seattle, WA` — and one key cannot hold two of them, so `normalizeLocations`
 * reads the text as the list of places it names and `normalizeLocation` stays
 * what it always was: one string in, one key out. The Corpus stores the list
 * (#113); the Dedup Key still reads the whole text through the single one,
 * because two Postings are the same opening only when they name the same places
 * in the same words.
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
 * The characters that stand between two places and never inside one.
 *
 * A semicolon or a pipe is a separator wherever it appears; a slash is one only
 * with whitespace around it, because a metro is written `Dallas/Fort Worth, TX`
 * and splitting that would invent a place called `dallas`. A comma is never a
 * separator at all — `Franklin, MA` is one place, and splitting on commas would
 * destroy every location in the Corpus.
 *
 * A metro written with the spaces in — `Dallas / Fort Worth, TX` — is read as
 * two places, and nothing distinguishes it from `Boston, MA / New York, NY`
 * without a gazetteer. That is the safe way round: both halves are real places
 * a geocoder knows, they sit within the same metro, and the radius measures the
 * closest — so a User near either one keeps the role, which is the answer the
 * unsplit reading would have given.
 *
 * Wrong in the safe direction, deliberately: a separator this does not
 * recognise leaves the text as one string, which is exactly how it behaved
 * before splitting existed (#113).
 */
const PLACE_SEPARATOR_RE = /\s*;\s*|\s*\|\s*|\s+\/\s+/;

/** One place a location text names: the employer's words for it, and its key. */
export type NamedPlace = {
  /**
   * The place as the employer wrote it, with the arrangement label and any
   * parenthetical aside taken off but the capitalisation left alone — what a
   * screen can show a User when it has to say which of several places it is
   * describing.
   */
  stated: string;
  /** The geocoding key, which is what the cache and the radius work in. */
  key: string;
};

/**
 * Every place a Posting's location text names, in the order it names them.
 *
 * The employer's words are kept beside the key because a screen measuring
 * against one of several places has to be able to say which one (#113), and
 * `seattle, wa` is a cache key rather than something to show somebody.
 * Duplicates collapse on the key: a location that names the same city twice is
 * one place, whichever way it spelled it the second time.
 */
export function placesNamed(raw: string | null | undefined): NamedPlace[] {
  if (!raw) return [];

  const places: NamedPlace[] = [];
  const seen = new Set<string>();

  for (const part of raw.split(PLACE_SEPARATOR_RE)) {
    const key = normalizeLocation(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    places.push({ stated: statedPlace(part), key });
  }

  return places;
}

/**
 * One place with the labels stripped and the employer's own capitalisation kept.
 *
 * The same three strips `normalizeLocation` makes, minus the lowercasing: a
 * screen naming `Austin, TX or Remote` as the place it measured to would be
 * showing a User something that is not a place name.
 */
function statedPlace(part: string): string {
  return part
    .replace(PARENTHETICAL_RE, "")
    .replace(LEADING_ARRANGEMENT_RE, "")
    .replace(TRAILING_REMOTE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The places a Posting's location text names, each as its own geocoding key
 * (#113).
 *
 * Empty when the text names none — the same answer `normalizeLocation` gives as
 * null, in the shape a caller holding several places wants. One entry for
 * ordinary single-place text, so a Posting that named one place before this
 * existed is geocoded, measured and cached exactly as it was.
 *
 * The parts that name no place are dropped rather than kept as holes: `San
 * Francisco, CA / Remote` is one place and a remote alternative, not two
 * places. Duplicates collapse, so a location that says the same city twice
 * costs one lookup.
 */
export function normalizeLocations(raw: string | null | undefined): string[] {
  return placesNamed(raw).map((place) => place.key);
}

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
