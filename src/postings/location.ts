import { US_STATE_CODE_ALTERNATION } from "./us-states";

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
 * geocoder is never called on a string that would only fail. A country named as
 * the location (`United States`, `Remote - US`) is null too, for the opposite
 * reason: the geocoder does not fail on it, it answers with the centre of the
 * country, and a point nobody meant is worse than none (#124).
 *
 * The null flattens two facts the **Location unresolved** flag has to tell
 * apart: a text that named a remote role, where there was never a Place to
 * find, and one that named nothing anyone could place (#123). `namesOnlyRemote`
 * is that distinction, read off the same pass over the text — one reading per
 * part (`readPart`), which each exported function then reduces its own way.
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
 * only one of these normalizes to null. The label is captured, because a text
 * that is only `Remote` and one that is only `Hybrid` normalize to the same
 * null and mean different things: the first names no Place because there is
 * none, the second has one it did not name (#123).
 */
const LEADING_ARRANGEMENT_RE =
  /^(?:fully\s+)?(remote|hybrid|on-?site|in[-\s]person|in[-\s]office)\b[\s:/,-]*/i;

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
 * A full stop the text ends with — `Greater Austin, TX.`, `Remote, USA.` — as
 * against the last period of an initialism, `Washington, D.C.`, which is the
 * spelling of the place rather than the end of a sentence (#120). Stripped so
 * a list whose last place was written with the period that separates the
 * others does not leave a key no other Posting shares.
 */
const TRAILING_FULL_STOP_RE = /(?<!\.\w)\.$/;

/**
 * Strings that say the role is remote without naming a Place: there is none,
 * so there is nothing to geocode. Normalizes straight to null, and reads as
 * remote rather than as a Place nobody could find (#123).
 */
const REMOTE_MARKERS = new Set([
  "remote",
  "fully remote",
  "anywhere",
  "work from home",
  "worldwide",
  "global",
]);

/**
 * A country, or a continent, named as the location — `United States`, `US`,
 * `USA`, `Canada`, `North America`. A nationwide marker: the role can be done
 * from anywhere in the country, which is remote at the scale of a nation, and
 * names no Place, because a country is not a commute (#124).
 *
 * Read exactly as a remote marker. It was a Place until it was not: `united
 * states` is a string a geocoder answers, with the geographic centre of the
 * country — a field outside Lebanon, Kansas — and 1,142 Postings were measured
 * against that field while `Remote (United States)` beside them named nothing.
 * A centroid is worse than no place: a Posting with none is kept and, where it
 * matters, flagged; one on a centroid is dropped for every User outside the
 * radius of the field and quoted a drive time to it for anyone inside.
 *
 * The spellings are the ones the Corpus has evidenced, matched against the
 * whole of a part rather than as a word inside it: `New York State, USA` and
 * `Washington, DC` are places whose names hold a country word. A trailing full
 * stop is already off by the time this is read (`usa.` is `usa`); the periods
 * inside an initialism are not (`u.s.` stays `u.s.`), so both spellings sit
 * here. A foreign country reads the same way, and for the same reason: the
 * classifier prunes a Posting whose location is only Canada (ADR 0010), and
 * the ones that reach here name it beside US places, where a point in northern
 * Saskatchewan was riding along with the real ones. Only the countries the
 * census found are listed; one it did not still reads as a place, which is
 * what it did before this existed. A state — `Massachusetts`, `Texas` — has the
 * same shape of wrongness at a smaller scale and is deliberately not here: a
 * state centroid is a decision for the ticket that measures it (#146,
 * ADR 0016).
 */
const NATIONWIDE_MARKERS = new Set([
  "united states",
  "united states of america",
  "us",
  "u.s.",
  "usa",
  "u.s.a.",
  "north america",
  "canada",
]);

/**
 * Whether a normalized part is a remote marker or a nationwide one — the two
 * sets read alike, and every reading below asks the same question of both.
 */
function isRemoteOrNationwideMarker(value: string): boolean {
  return REMOTE_MARKERS.has(value) || NATIONWIDE_MARKERS.has(value);
}

/**
 * Strings an employer writes where a Place should be, that name none: a
 * placeholder for a Place the text does not disclose. Normalizes straight to
 * null, costing no external call — and unlike a remote marker it is a real miss
 * the User should be told about, since there is a Place and nothing says
 * where. `flexible` sits here rather than with the remote markers deliberately:
 * it as often means "any of our sites" as "from home", and flagging is the
 * direction to be wrong in.
 */
const PLACEHOLDERS = new Set([
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
 * What stands between two places and never inside one.
 *
 * A semicolon or a pipe is a separator wherever it appears; a slash is one only
 * with whitespace around it, because a metro is written `Dallas/Fort Worth, TX`
 * and splitting that would invent a place called `dallas`. A comma is never a
 * separator at all — `Franklin, MA` is one place, and splitting on commas would
 * destroy every location in the Corpus.
 *
 * An employer joins two places with a word as readily as with a mark —
 * `Denver, CO or Menlo Park, CA` — so `or` is a separator too (#119), with one
 * exception: `or` is also Oregon's postal code. After a comma it is the state,
 * which is why `Portland, OR or Seattle, WA` splits once rather than twice and
 * `Portland, OR` is not touched at all. The cost of reading it that way is the
 * Oxford comma — `Reno, NV, or Batesville, IN` stays one string — which is the
 * direction to be wrong in, and is what those texts did before this existed.
 *
 * A metro written with the spaces in — `Dallas / Fort Worth, TX` — is read as
 * two places, and nothing distinguishes it from `Boston, MA / New York, NY`
 * without a gazetteer. That is the safe way round: both halves are real places
 * a geocoder knows, they sit within the same metro, and the radius measures the
 * closest — so a User near either one keeps the role, which is the answer the
 * unsplit reading would have given. `Truth or Consequences, NM` is the same
 * reading in the same direction: a real place whose name holds the word.
 *
 * A period is one too, in one shape only: after a USPS state code that follows
 * a comma — `Fort Wayne, IN. Mooresville, IN.` (#120). A period is the comma's
 * trap otherwise. It ends `St.`, `Ft.` and `Mt.` as readily as a place, and
 * `St.` follows a comma in `Plaza at Frotenac, St. Louis, MO` exactly where
 * `IN.` does above, so nothing in the shape of the text separates them. What
 * does is knowing `IN` is a state and `St` is not, which is why the rule reads
 * the state-code table (`us-states.ts`) rather than "any two letters". The
 * code is matched in capitals, as the country classifier matches it: `Co.` is
 * a company, and `co` is Colorado only when written `CO`. A period at the very
 * end of the text is the same separator with nothing after it, so
 * `Mooresville, IN.` ends cleanly rather than leaving `mooresville, in.` as
 * the key.
 *
 * Wrong in the safe direction, deliberately: a separator this does not
 * recognise leaves the text as one string, which is exactly how it behaved
 * before splitting existed (#113).
 */
const PLACE_SEPARATOR_RE = new RegExp(
  [
    /\s*;\s*/.source,
    /\s*\|\s*/.source,
    /\s+\/\s+/.source,
    // The word in either case; the state codes below are matched in capitals
    // only, which is why the whole expression cannot carry the `i` flag.
    /(?<!,\s*)\s+[oO][rR]\s+/.source,
    `(?<=,\\s*${US_STATE_CODE_ALTERNATION})\\.(?:\\s+|$)`,
  ].join("|"),
);

/**
 * The conjunction a preceding separator left stranded at the front of a place —
 * the `or` in `Seattle, WA; or New York, NY`, which the semicolon split off
 * with the place rather than with the list before it (#119).
 *
 * Worth stripping rather than leaving: `or new york, ny` is a string a geocoder
 * answers, with a point that is not New York. Only ever from a part something
 * separated, though — a text that opens with the word opens with a place name,
 * and `Or Yehuda, Israel` is not in Yehuda.
 */
const LEADING_CONJUNCTION_RE = /^\s*(?:or|and)\s+/i;

/**
 * What one part of a location text names: a Place, with its key; remote, and
 * nothing anyone could place; or nothing at all — a placeholder, an Arrangement
 * label with no Place after it, or punctuation a strip left behind.
 */
type Reading =
  | { names: "place"; key: string }
  | { names: "remote" }
  | { names: "nothing" };

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

  for (const [part, reading] of readParts(raw)) {
    if (reading.names !== "place" || seen.has(reading.key)) continue;
    seen.add(reading.key);
    places.push({ stated: statedPlace(part), key: reading.key });
  }

  return places;
}

/**
 * The parts a location text splits into, each with what it names — blank
 * parts left out, since a split that leaves an empty string behind wrote
 * nothing rather than named nothing. The part is kept beside its reading
 * because `placesNamed` still has to show the employer's words for it.
 *
 * The aside comes off the whole text before it is split, so a separator inside
 * one cannot break a bracket across two places: `Remote - US (East / Central)`
 * is one place with a note about it, not `us (east` and `central)` — two
 * strings the geocoder answered with a point describing neither (#119).
 */
function readParts(raw: string): [part: string, reading: Reading][] {
  const readings: [string, Reading][] = [];

  const parts = raw.replace(PARENTHETICAL_RE, "").split(PLACE_SEPARATOR_RE);
  for (const [index, part] of parts.entries()) {
    // A stranded conjunction only ever follows a separator, so the first part
    // keeps its opening word: it is part of the place's name, not a join.
    const place = index === 0 ? part : part.replace(LEADING_CONJUNCTION_RE, "");
    const reading = readPart(place);
    if (reading) readings.push([place, reading]);
  }

  return readings;
}

/**
 * Whether a location text names remote and nothing else — `Remote`, `Remote
 * (United States)`, `Fully remote` — as against one that names nothing anyone
 * could place (#123).
 *
 * Both normalize to null, and the difference is the whole question for the
 * **Location unresolved** flag: a remote-only text names no Place because the
 * role has none, so the radius did not fail to place anything, while `Multiple
 * locations` or a bare `Hybrid` has a Place the employer did not name, which is
 * a miss the User should see.
 *
 * Read part by part through the same split `placesNamed` makes, so `Remote /
 * Work from home` is only remote and `Remote / Multiple locations` is not. A
 * text naming a Place is never only remote, whatever else it says; empty text
 * names nothing, not remote.
 */
export function namesOnlyRemote(raw: string | null | undefined): boolean {
  if (!raw) return false;

  const readings = readParts(raw).map(([, reading]) => reading);
  return (
    readings.length > 0 && readings.every((reading) => reading.names === "remote")
  );
}

/**
 * One place with the labels stripped and the employer's own capitalisation kept.
 *
 * The same strips `normalizeLocation` makes, minus the lowercasing: a screen
 * naming `Austin, TX or Remote` as the place it measured to would be showing a
 * User something that is not a place name.
 */
function statedPlace(part: string): string {
  return trimEdges(
    part
      .replace(PARENTHETICAL_RE, "")
      .replace(LEADING_ARRANGEMENT_RE, "")
      .replace(TRAILING_REMOTE_RE, "")
      .replace(/\s+/g, " "),
  );
}

/**
 * The punctuation a strip or a split leaves at either edge of a place — the
 * comma a removed label sat after, the full stop a list was written with —
 * taken off so the key and the stated place end where the name does.
 */
function trimEdges(value: string): string {
  return value
    .replace(/^[\s,/-]+|[\s,/-]+$/g, "")
    .replace(TRAILING_FULL_STOP_RE, "")
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
  const reading = readPart(raw);
  return reading?.names === "place" ? reading.key : null;
}

/**
 * The one reading of a part, which every exported function reduces its own
 * way: `normalizeLocation` to the key or null, `placesNamed` to the places,
 * `namesOnlyRemote` to whether anything but remote was named. Null for blank
 * text, so a split that left an empty part behind counts it as nothing written
 * rather than as nothing named.
 *
 * Remote is read from what the strips took off as much as from what they left:
 * `Remote (United States)` is bare `remote` once the aside is gone, `Remote -
 * Anywhere` is a remote label and a remote marker, `Remote - US` is a remote
 * label and a nationwide one (#124), `Boston, MA or Remote` is a Place. An
 * onsite or hybrid Arrangement label — `Hybrid`, `Onsite` — with no Place
 * after it names one and withholds it, which is nothing rather than remote
 * whatever follows the label: `Hybrid - Anywhere` and `Hybrid - United States`
 * are a commute to somewhere unstated. A placeholder after a remote label,
 * `Remote - TBD`, is a placeholder.
 */
function readPart(raw: string | null | undefined): Reading | null {
  if (!raw) return null;

  const bare = raw.replace(PARENTHETICAL_RE, "");
  if (!bare.trim()) return null;

  const label = bare.match(LEADING_ARRANGEMENT_RE)?.[1]?.toLowerCase();
  const unlabelled = bare.replace(LEADING_ARRANGEMENT_RE, "");
  const offersRemote =
    label === "remote" || TRAILING_REMOTE_RE.test(unlabelled);

  let value = unlabelled
    .replace(TRAILING_REMOTE_RE, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  value = trimEdges(value);

  // Collapse the whitespace left where a comma now has nothing after it.
  value = value.replace(/\s*,\s*(?=,|$)/g, "").trim();

  if (PLACEHOLDERS.has(value)) return { names: "nothing" };
  if (value && !isRemoteOrNationwideMarker(value)) return { names: "place", key: value };
  // Named no Place. An onsite or hybrid label names one it did not disclose.
  if (label != null && label !== "remote") return { names: "nothing" };
  if (offersRemote || isRemoteOrNationwideMarker(value)) return { names: "remote" };
  return { names: "nothing" };
}
