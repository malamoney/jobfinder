import { describe, expect, it } from "vitest";
import {
  namesOnlyRemote,
  normalizeLocation,
  normalizeLocations,
  placesNamed,
} from "./location";

/**
 * Location normalization is a pure function over a Posting's free-text location
 * (#12). Geocoding is cached by the string this returns, not per Posting —
 * `Greater Boston Area` recurs across thousands of Postings and should cost one
 * external call, not thousands.
 *
 * The lower seam the testing plan allows (#2). It formats a messy location into
 * a stable key a geocoder can read, and returns null when the text names no
 * place at all — a null is surfaced as unresolved, never geocoded.
 */
describe("normalizing a Posting's location", () => {
  it("lowercases and collapses whitespace so spelling variants share a key", () => {
    expect(normalizeLocation("San Francisco,  CA")).toBe("san francisco, ca");
    expect(normalizeLocation("  New York,\tNY  ")).toBe("new york, ny");
  });

  it("strips a trailing remote alternative, keeping the place", () => {
    expect(normalizeLocation("San Francisco, CA / Remote")).toBe(
      "san francisco, ca",
    );
    expect(normalizeLocation("Austin, TX (Remote)")).toBe("austin, tx");
    expect(normalizeLocation("Boston, MA or Remote")).toBe("boston, ma");
  });

  it("strips a leading arrangement label, keeping the place", () => {
    expect(normalizeLocation("Hybrid - London")).toBe("london");
    expect(normalizeLocation("Remote - Austin, TX")).toBe("austin, tx");
    expect(normalizeLocation("Onsite: Berlin")).toBe("berlin");
  });

  it("names no place when what follows the label is the country", () => {
    // `Remote - US` was this test's example of a label stripped from a place,
    // and `us` was the key it expected — deliberately, when it was written.
    // The geocoder answers that key with the geographic centre of the United
    // States, a field in Kansas, and the radius measured 1,142 Postings against
    // it (#124). A nationwide marker names no place, whichever way it is
    // written, so the label case above keeps a real place and this one pins
    // the country as null.
    expect(normalizeLocation("Remote - US")).toBeNull();
  });

  it("drops a parenthetical aside", () => {
    expect(normalizeLocation("Hybrid - London (3 days in office)")).toBe(
      "london",
    );
  });

  it("keeps a vague but real place name", () => {
    expect(normalizeLocation("Greater Boston Area")).toBe("greater boston area");
  });

  it("returns null when the text names no place", () => {
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation("")).toBeNull();
    expect(normalizeLocation("   ")).toBeNull();
    expect(normalizeLocation("Remote")).toBeNull();
    expect(normalizeLocation("Fully remote")).toBeNull();
    expect(normalizeLocation("Multiple locations")).toBeNull();
    expect(normalizeLocation("Various")).toBeNull();
    expect(normalizeLocation("Anywhere")).toBeNull();
  });
});

/**
 * A Posting whose location names more than one place (#113). `San Francisco Bay
 * Area, CA / Seattle, WA` used to normalize to one key no geocoder could place,
 * so the radius kept the Posting for everybody, everywhere, permanently.
 *
 * The rule is deliberately narrow: split on separators that only ever stand
 * between two places, and leave everything else exactly as it was. An unsplit
 * string behaves today the way it behaved before this existed, which is the
 * direction to be wrong in.
 */
describe("reading the places a Posting's location names", () => {
  it("splits a location written with a spaced slash", () => {
    expect(
      normalizeLocations("Hybrid - San Francisco Bay Area, CA / Seattle, WA"),
    ).toEqual(["san francisco bay area, ca", "seattle, wa"]);
  });

  it("splits on a semicolon and on a pipe", () => {
    expect(normalizeLocations("Boston, MA; New York, NY")).toEqual([
      "boston, ma",
      "new york, ny",
    ]);
    expect(normalizeLocations("Boston, MA | New York, NY")).toEqual([
      "boston, ma",
      "new york, ny",
    ]);
  });

  it("never splits on a comma, which sits inside a single place", () => {
    expect(normalizeLocations("Franklin, MA")).toEqual(["franklin, ma"]);
  });

  it("never splits a slash a place name is written with", () => {
    expect(normalizeLocations("Dallas/Fort Worth, TX")).toEqual([
      "dallas/fort worth, tx",
    ]);
  });

  it("reads a single-place location exactly as the single normalizer does", () => {
    expect(normalizeLocations("San Francisco,  CA")).toEqual([
      "san francisco, ca",
    ]);
    expect(normalizeLocations("Austin, TX (Remote)")).toEqual(["austin, tx"]);
    expect(normalizeLocations("Hybrid - London (3 days in office)")).toEqual([
      "london",
    ]);
  });

  it("drops the parts that name no place, keeping the ones that do", () => {
    expect(normalizeLocations("San Francisco, CA / Remote")).toEqual([
      "san francisco, ca",
    ]);
    expect(normalizeLocations("Remote / Multiple locations")).toEqual([]);
  });

  it("keeps one entry for a place named twice", () => {
    expect(normalizeLocations("Boston, MA / Boston,  MA")).toEqual([
      "boston, ma",
    ]);
  });

  it("returns nothing when the text names no place at all", () => {
    expect(normalizeLocations(null)).toEqual([]);
    expect(normalizeLocations("")).toEqual([]);
    expect(normalizeLocations("Remote")).toEqual([]);
  });
});

/**
 * The employer's own words for each place, kept beside the key so a screen
 * measuring against one of several places can say which one it measured (#113).
 */
describe("naming the places a location text names", () => {
  it("keeps each place as the employer capitalised it", () => {
    expect(
      placesNamed("Hybrid - San Francisco Bay Area, CA / Seattle, WA"),
    ).toEqual([
      { stated: "San Francisco Bay Area, CA", key: "san francisco bay area, ca" },
      { stated: "Seattle, WA", key: "seattle, wa" },
    ]);
  });

  it("names a single place as the whole location, labels aside", () => {
    expect(placesNamed("Hybrid - London (3 days in office)")).toEqual([
      { stated: "London", key: "london" },
    ]);
  });

  it("leaves a remote alternative out of the place's name", () => {
    expect(placesNamed("Boston, MA / Austin, TX or Remote")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
      { stated: "Austin, TX", key: "austin, tx" },
    ]);
  });
});

/**
 * The two readings of a slash the rule cannot tell apart, pinned so the choice
 * is a decision rather than an accident (#113, ADR 0016).
 */
describe("a slash between two halves of one metro", () => {
  it("reads a spaced metro as its two towns, which are both real places", () => {
    expect(normalizeLocations("Dallas / Fort Worth, TX")).toEqual([
      "dallas",
      "fort worth, tx",
    ]);
  });
});

/**
 * A word between two places (#119, ADR 0016). Employers join two places with
 * `or` as readily as with a slash — `Denver, CO or Menlo Park, CA` — and the
 * key that made was one no geocoder could place, which is the exact condition
 * #113 was opened about reached by a different spelling.
 *
 * The word `or` is also Oregon's postal code, so the rule has to tell the
 * separator from the state: after a comma, `OR` is the state.
 */
describe("a word between two places", () => {
  it("splits a location whose places are joined by 'or'", () => {
    expect(normalizeLocations("Denver, CO or Menlo Park, CA")).toEqual([
      "denver, co",
      "menlo park, ca",
    ]);
    expect(normalizeLocations("Herndon, VA OR Columbia, MD")).toEqual([
      "herndon, va",
      "columbia, md",
    ]);
    // Three places, and the word in capitals. This read `Massachusetts OR
    // Maryland OR Greater Austin, TX` until a bare state stopped being a place
    // (#146); the split is the same, and the state case is tested with the rule.
    expect(
      normalizeLocations("Worcester, MA OR Baltimore, MD OR Greater Austin, TX"),
    ).toEqual(["worcester, ma", "baltimore, md", "greater austin, tx"]);
  });

  it("reads Oregon's postal code as the state, not as a separator", () => {
    expect(normalizeLocations("Portland, OR")).toEqual(["portland, or"]);
    expect(normalizeLocations("Portland, OR or Seattle, WA")).toEqual([
      "portland, or",
      "seattle, wa",
    ]);
    expect(normalizeLocations("Portland,  OR  or  Seattle, WA")).toEqual([
      "portland, or",
      "seattle, wa",
    ]);
    expect(normalizeLocations("Eugene, OR or Bend, OR")).toEqual([
      "eugene, or",
      "bend, or",
    ]);
  });

  it("still reads a remote alternative as no second place", () => {
    expect(normalizeLocations("Boston, MA or Remote")).toEqual(["boston, ma"]);
    // A country-wide remote alternative used to read as the country, exactly
    // as `Remote - US` did. Both name no place now (#124) — the split does not
    // change that, it just reaches it one part at a time.
    expect(normalizeLocations("Houston, TX or Remote, USA")).toEqual([
      "houston, tx",
    ]);
    expect(placesNamed("Boston, MA or Remote")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
    ]);
  });

  it("drops the conjunction a preceding separator left at the front", () => {
    expect(
      normalizeLocations("San Diego, CA; Seattle, WA; or New York, NY"),
    ).toEqual(["san diego, ca", "seattle, wa", "new york, ny"]);
    expect(placesNamed("Boston, MA; or Austin, TX")).toEqual([
      { stated: "Boston, MA", key: "boston, ma" },
      { stated: "Austin, TX", key: "austin, tx" },
    ]);
  });

  it("keeps the opening word of a place whose name begins with one", () => {
    // Nothing separated the first part, so its `Or` is the place's own name.
    expect(normalizeLocations("Or Yehuda, Israel")).toEqual([
      "or yehuda, israel",
    ]);
    expect(normalizeLocations("Or Yehuda, Israel; Boston, MA")).toEqual([
      "or yehuda, israel",
      "boston, ma",
    ]);
  });

  it("leaves the separators it was not taught alone", () => {
    expect(
      normalizeLocations("San Fernando Valley & Pasadena, CA"),
    ).toEqual(["san fernando valley & pasadena, ca"]);
    expect(normalizeLocations("Wilkes-Barre, PA, Reno, NV, or Batesville, IN")).toEqual([
      "wilkes-barre, pa, reno, nv, or batesville, in",
    ]);
  });
});

/**
 * A period between two places (#120, ADR 0016). Two employers write every one
 * of their offices into one field — `Fort Wayne, IN. Mooresville, IN.`,
 * `Richmond, VA. Culpeper, VA. Herndon, VA.` — and the key that made was the
 * third spelling of #113's unplaceable string.
 *
 * A period is the comma's trap: it also ends `St.`, `Ft.` and `Mt.`, and `St.`
 * follows a comma exactly where a state code does. The only rule that tells
 * them apart is one that knows `IN` is a state and `St` is not, so the rule
 * reads the USPS state-code table (`us-states.ts`).
 */
describe("a period between two places", () => {
  it("splits a location whose places end in a state code and a period", () => {
    expect(normalizeLocations("Fort Wayne, IN. Mooresville, IN.")).toEqual([
      "fort wayne, in",
      "mooresville, in",
    ]);
    expect(
      normalizeLocations("Richmond, VA. Culpeper, VA. Herndon, VA."),
    ).toEqual(["richmond, va", "culpeper, va", "herndon, va"]);
    expect(
      normalizeLocations("Houston, TX. San Francisco, CA. Long Beach, CA."),
    ).toEqual(["houston, tx", "san francisco, ca", "long beach, ca"]);
    expect(normalizeLocations("Washington, DC. Arlington, VA.")).toEqual([
      "washington, dc",
      "arlington, va",
    ]);
  });

  it("leaves a period that is not a state code's alone", () => {
    // `St.` follows a comma exactly where `IN.` does above; only the table
    // separates them.
    expect(normalizeLocations("Plaza at Frotenac, St. Louis, MO")).toEqual([
      "plaza at frotenac, st. louis, mo",
    ]);
    expect(normalizeLocations("Lake St. Louis, MO")).toEqual([
      "lake st. louis, mo",
    ]);
    expect(normalizeLocations("Mt. Pleasant, SC")).toEqual(["mt. pleasant, sc"]);
    // `Co.` is a company, not Colorado: the code is written in capitals.
    expect(normalizeLocations("The Jaydor Co. - East Norristown, PA")).toEqual([
      "the jaydor co. - east norristown, pa",
    ]);
  });

  it("reads an abbreviated place name as part of the place, not a break", () => {
    expect(normalizeLocations("Ft. Wayne, IN. Mooresville, IN.")).toEqual([
      "ft. wayne, in",
      "mooresville, in",
    ]);
  });

  it("does not split a code the text does not write in capitals", () => {
    // Case-sensitive on purpose, like the country classifier: `, in.` is as
    // likely to be prose as Indiana, and an unsplit text is the safe reading.
    // Only the full stop at the end comes off, as it does from any key.
    expect(normalizeLocations("Fort Wayne, in. Mooresville, in.")).toEqual([
      "fort wayne, in. mooresville, in",
    ]);
  });

  it("leaves no trailing period on the last key", () => {
    expect(normalizeLocations("Houston, TX. Remote, Austin, TX.")).toEqual([
      "houston, tx",
      "austin, tx",
    ]);
    expect(normalizeLocations("Greater Austin, TX.")).toEqual([
      "greater austin, tx",
    ]);
    expect(normalizeLocation("Remote, Austin, TX.")).toBe("austin, tx");
    // An initialism keeps its final period: it is the spelling, not a full stop.
    expect(normalizeLocation("Washington, D.C.")).toBe("washington, d.c.");
    expect(normalizeLocation("Remote - Washington, D.C.")).toBe(
      "washington, d.c.",
    );
    // `usa.` and `u.s.a.` were this rule's own examples: the strip made `usa.`
    // the same key as `usa`, and left the initialism its final period. Both
    // are read the same way still, and now name no place at all (#124).
    expect(normalizeLocation("Remote, USA.")).toBeNull();
    expect(normalizeLocation("Remote - U.S.A.")).toBeNull();
  });

  it("names each place without the period that ended it", () => {
    expect(placesNamed("Fort Wayne, IN. Mooresville, IN.")).toEqual([
      { stated: "Fort Wayne, IN", key: "fort wayne, in" },
      { stated: "Mooresville, IN", key: "mooresville, in" },
    ]);
    expect(placesNamed("Houston, TX. Remote, Austin, TX.")).toEqual([
      { stated: "Houston, TX", key: "houston, tx" },
      { stated: "Austin, TX", key: "austin, tx" },
    ]);
  });
});

/**
 * A separator inside a parenthetical aside is not a separator: the aside is
 * taken off the whole text before it is split, so a bracket cannot be broken
 * across two places (#119). `Remote - US (East / Central)` used to normalize to
 * `us (east` and `central)`, two keys a geocoder answered with a point that
 * described neither.
 */
describe("a separator inside a parenthetical aside", () => {
  it("splits nothing inside the brackets, and keeps the place outside them", () => {
    expect(normalizeLocations("Remote - Austin, TX (East / Central)")).toEqual([
      "austin, tx",
    ]);
    expect(normalizeLocations("Remote (East Coast USA or Canada) / UK")).toEqual([
      "uk",
    ]);
    // These two were the cases #119 was written about, and read as `us` and
    // `united states` then — one key each, rather than the two scraps the
    // split-inside-the-bracket bug made. A country names no place now (#124),
    // so they read as nothing at all; still one reading, still not two scraps.
    expect(normalizeLocations("Remote - US (East / Central)")).toEqual([]);
    expect(normalizeLocations("United States (Remote or Hybrid)")).toEqual([]);
  });

  it("still splits the separators outside the brackets", () => {
    expect(
      normalizeLocations("Boston, MA (HQ) / Austin, TX (3 days in office)"),
    ).toEqual(["boston, ma", "austin, tx"]);
  });
});

/**
 * A location that names remote and nothing else (#123). `normalizeLocation`
 * answers null for `Remote (United States)` and for `Multiple locations` alike,
 * and the **Location unresolved** flag read both as a Place nobody could find.
 * The first is not a miss: the role has no Place, so there was never anything
 * to find. This predicate is how the flag tells the two apart.
 */
describe("a location that names only remote", () => {
  it("is true for text that names remote and nothing else", () => {
    expect(namesOnlyRemote("Remote")).toBe(true);
    expect(namesOnlyRemote("Fully remote")).toBe(true);
    expect(namesOnlyRemote("Remote (United States)")).toBe(true);
    expect(namesOnlyRemote("Remote (New York)")).toBe(true);
    expect(namesOnlyRemote("Remote - Anywhere")).toBe(true);
    expect(namesOnlyRemote("Work from home")).toBe(true);
    expect(namesOnlyRemote("Worldwide")).toBe(true);
    expect(namesOnlyRemote("Remote / Work from home")).toBe(true);
  });

  it("is true for a nationwide marker, which is remote at the scale of a country", () => {
    // `Remote - US` was pinned false here when the country still read as a
    // place (#123). It names none (#124), and the remote label is what is
    // left — the same reading `Remote (United States)` always had.
    expect(namesOnlyRemote("Remote - US")).toBe(true);
    expect(namesOnlyRemote("Remote - United States")).toBe(true);
    expect(namesOnlyRemote("United States")).toBe(true);
    expect(namesOnlyRemote("Remote - United States / Canada")).toBe(true);
    expect(namesOnlyRemote("Remote - USA | Remote")).toBe(true);
  });

  it("is false for a hybrid role somewhere in the country, which withholds its place", () => {
    expect(namesOnlyRemote("Hybrid - United States")).toBe(false);
    expect(namesOnlyRemote("Onsite - USA")).toBe(false);
  });

  it("is false for a placeholder, which still names nothing anyone could place", () => {
    expect(namesOnlyRemote("Multiple locations")).toBe(false);
    expect(namesOnlyRemote("Various")).toBe(false);
    expect(namesOnlyRemote("TBD")).toBe(false);
    expect(namesOnlyRemote("Remote / Multiple locations")).toBe(false);
    expect(namesOnlyRemote("Remote - TBD")).toBe(false);
  });

  it("is false for an onsite or hybrid label that names no place", () => {
    // A hybrid or onsite role with no Place named is a real miss: the User
    // would have to go somewhere, and nothing says where.
    expect(namesOnlyRemote("Hybrid")).toBe(false);
    expect(namesOnlyRemote("Onsite")).toBe(false);
    expect(namesOnlyRemote("Hybrid - Anywhere")).toBe(false);
  });

  it("is false for text that names a place, whether or not it names remote too", () => {
    expect(namesOnlyRemote("Boston, MA")).toBe(false);
    expect(namesOnlyRemote("Boston, MA or Remote")).toBe(false);
    expect(namesOnlyRemote("Bolt Farm - Whitwell, TN")).toBe(false);
    expect(namesOnlyRemote("Undisclosed location, USA")).toBe(false);
  });

  it("is false for empty text, which names nothing at all", () => {
    expect(namesOnlyRemote(null)).toBe(false);
    expect(namesOnlyRemote("")).toBe(false);
    expect(namesOnlyRemote("   ")).toBe(false);
  });
});

/**
 * A country named as the location is a nationwide marker, and a nationwide
 * marker names no place (#124). `Remote - United States` used to normalize to
 * `united states`, which the geocoder answers with the geographic centre of the
 * country — a field outside Lebanon, Kansas — and 1,142 Postings were then
 * measured against that field: dropped for every User outside its radius, and
 * quoted a drive time to it for anyone inside. `Remote (United States)` read as
 * no place all along; the only difference was a bracket.
 */
describe("a country named as the location", () => {
  it("names no place, whichever way the country is written", () => {
    expect(normalizeLocations("Remote - United States")).toEqual([]);
    expect(normalizeLocations("Remote - US")).toEqual([]);
    expect(normalizeLocations("Remote US")).toEqual([]);
    expect(normalizeLocations("Remote, USA")).toEqual([]);
    expect(normalizeLocations("Remote - U.S. Remote")).toEqual([]);
    expect(normalizeLocations("Remote - USA - Remote")).toEqual([]);
    expect(normalizeLocations("Remote - USA | Remote")).toEqual([]);
    expect(normalizeLocations("USA Remote")).toEqual([]);
    expect(normalizeLocations("Remote (United States)")).toEqual([]);
    expect(normalizeLocations("United States of America")).toEqual([]);
    expect(normalizeLocations("U.S.A.")).toEqual([]);
    expect(normalizeLocations("USA.")).toEqual([]);
    expect(normalizeLocations("North America")).toEqual([]);
  });

  it("drops the country out of a list and keeps the cities", () => {
    // `new jersey` was in this list until a state read as a place; under a
    // remote label it is remote-within-a-state, and drops out too (#146).
    expect(
      normalizeLocations("Remote - United States / New Jersey / Boston / New York"),
    ).toEqual(["boston", "new york"]);
  });

  it("reads a foreign country the same way: a country is not a commute", () => {
    // The classifier prunes a Posting whose location is only Canada (ADR 0010);
    // the ones that reach here name it beside US places, and a centroid in
    // northern Saskatchewan was riding along with the real ones.
    expect(normalizeLocations("Remote - United States / Canada")).toEqual([]);
    expect(normalizeLocations("Boston, MA / Canada")).toEqual(["boston, ma"]);
  });

  it("leaves a real place whose name holds a country word alone", () => {
    expect(normalizeLocations("Washington, DC")).toEqual(["washington, dc"]);
    expect(normalizeLocations("New York State, USA")).toEqual([
      "new york state, usa",
    ]);
    expect(normalizeLocations("Undisclosed location, USA")).toEqual([
      "undisclosed location, usa",
    ]);
  });

  it("keeps the country key out of the Dedup Key's location too", () => {
    // The single-string normalizer is what the Dedup Key reads (ADR 0006), and
    // every place-less listing contributes the same empty component there.
    expect(normalizeLocation("United States")).toBeNull();
    expect(normalizeLocation("Remote - USA")).toBeNull();
  });
});

/**
 * A state named as the whole of a place is #124's defect at a smaller scale
 * (#146). `Remote - Massachusetts` normalized to `massachusetts`, which the
 * geocoder answers with the state's centroid — a point in Worcester County — and
 * the radius then dropped the Posting for a User in Boston, 45 miles from a spot
 * nobody named. Under a remote label a state is remote-within-a-state and names
 * no Place; bare, it is a placeholder for a Place the employer did not name.
 */
describe("a state named as the location", () => {
  it("names no place under a remote label, whichever way the state is written", () => {
    expect(normalizeLocations("Remote - Massachusetts")).toEqual([]);
    expect(normalizeLocations("Remote-Texas")).toEqual([]);
    expect(normalizeLocations("Remote, Pennsylvania")).toEqual([]);
    expect(normalizeLocations("Remote- Utah")).toEqual([]);
    expect(normalizeLocations("Texas (Remote)")).toEqual([]);
    expect(normalizeLocations("California - Remote")).toEqual([]);
    expect(normalizeLocations("Arizona Remote (NavVis Inc.)")).toEqual([]);
    expect(normalizeLocations("Georgia or Remote")).toEqual([]);
  });

  it("reads as remote, so a remote-within-a-state Posting wears no unresolved pill", () => {
    expect(namesOnlyRemote("Remote - Massachusetts")).toBe(true);
    expect(namesOnlyRemote("Texas (Remote)")).toBe(true);
    expect(namesOnlyRemote("Remote-Texas / Remote-Florida / Remote")).toBe(true);
    expect(
      namesOnlyRemote("Remote; Remote, New Jersey; Remote, Pennsylvania; Remote, Virginia"),
    ).toBe(true);
  });

  it("reads a state code exactly as it reads the state's name", () => {
    expect(normalizeLocations("Remote - MA")).toEqual([]);
    expect(normalizeLocations("Remote, TX")).toEqual([]);
    expect(normalizeLocations("Remote, DC")).toEqual([]);
    expect(namesOnlyRemote("Remote - MA")).toBe(true);
    expect(normalizeLocations("MA")).toEqual([]);
    expect(namesOnlyRemote("MA")).toBe(false);
  });

  it("reads a bare state as a placeholder: a Place the employer did not name", () => {
    // Kept and flagged, like `Multiple locations` — there is a Place, and
    // nothing says where. Not measured against a centroid in a forest.
    expect(normalizeLocations("Texas")).toEqual([]);
    expect(normalizeLocations("Georgia ")).toEqual([]);
    expect(normalizeLocations("Louisiana; Texas")).toEqual([]);
    expect(normalizeLocations("Onsite - Hawaii")).toEqual([]);
    expect(normalizeLocations("Hybrid - Texas")).toEqual([]);
    expect(namesOnlyRemote("Texas")).toBe(false);
    expect(namesOnlyRemote("Louisiana; Texas")).toBe(false);
    expect(namesOnlyRemote("Hybrid - Texas")).toBe(false);
  });

  it("lets a remote label at the front of a list cover every state in it", () => {
    // The label is the Posting's, prefixed to the whole list by the adapter
    // (`placeWithArrangement`), so `Remote - Canada / Utah / Georgia` says
    // remote in Utah and remote in Georgia — not one remote and two offices.
    expect(
      normalizeLocations("Remote - Canada / Utah / New York / Georgia / Ohio"),
    ).toEqual(["new york"]);
    expect(namesOnlyRemote("Remote - Texas / Florida / North Carolina")).toBe(true);
    // A hybrid list says the opposite: a state in it is an office withheld.
    expect(
      normalizeLocations("Hybrid - Cambridge / Utah / Georgia / Boston"),
    ).toEqual(["cambridge", "boston"]);
    expect(namesOnlyRemote("Hybrid - Texas / Florida")).toBe(false);
  });

  it("drops the state out of a list and keeps the cities", () => {
    expect(
      normalizeLocations("Dallas, Texas; Houston, Texas; Remote - Texas"),
    ).toEqual(["dallas, texas", "houston, texas"]);
    expect(normalizeLocations("Connecticut or New York State, USA")).toEqual([
      "new york state, usa",
    ]);
    expect(
      normalizeLocations("Massachusetts OR Maryland OR Greater Austin, TX."),
    ).toEqual(["greater austin, tx"]);
  });

  it("leaves a state that is also a city alone, so New York and Washington still resolve", () => {
    expect(normalizeLocations("New York")).toEqual(["new york"]);
    expect(normalizeLocations("Hybrid - New York")).toEqual(["new york"]);
    expect(normalizeLocations("Remote - New York")).toEqual(["new york"]);
    expect(normalizeLocations("New York, NY")).toEqual(["new york, ny"]);
    expect(normalizeLocations("Washington")).toEqual(["washington"]);
    expect(normalizeLocations("Washington (Remote)")).toEqual(["washington"]);
    expect(normalizeLocations("Washington, DC")).toEqual(["washington, dc"]);
    // The code follows the name, so the pair reads alike either way.
    expect(normalizeLocations("Remote - NY")).toEqual(["ny"]);
    expect(normalizeLocations("Remote - WA")).toEqual(["wa"]);
  });

  it("leaves a real place whose name holds a state alone", () => {
    expect(normalizeLocations("Austin, Texas")).toEqual(["austin, texas"]);
    expect(normalizeLocations("Texas City, TX")).toEqual(["texas city, tx"]);
    expect(normalizeLocations("Washington, D.C.")).toEqual(["washington, d.c."]);
    expect(normalizeLocations("Remote - Washington(US)")).toEqual(["washington"]);
  });

  it("keeps the state key out of the Dedup Key's location too", () => {
    expect(normalizeLocation("Remote - Texas")).toBeNull();
    expect(normalizeLocation("Texas")).toBeNull();
    expect(normalizeLocation("Remote - MA")).toBeNull();
  });
});
