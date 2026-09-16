# A Posting names a list of places, and the closest one decides

A Posting's location text is read as the *list* of places it names rather than as one string. The
Corpus stores that list (`postings.normalized_locations`, a `text[]`), the Geocode Cache holds a row
per place as it always did, and the commute radius measures a User against the **closest** of a
Posting's places: it drops the Posting only when every place it could put on a map is out of range.

The splitting rule is deliberately narrow (`normalizeLocations`, `src/postings/location.ts`). A
semicolon or a pipe separates two places wherever it appears; a slash does only with whitespace
around it, because `Dallas/Fort Worth, TX` is one place; the word `or` does except where it is
Oregon's postal code (#119, below); and a period does only after a US state code that follows a
comma (#120, below). A comma never separates anything — `Franklin, MA` is one place,
and splitting on commas would destroy every location in the Corpus. A text the rule does not split
behaves exactly as it did before this existed, which is the direction to be wrong in.

The one reading the rule gets "wrong" it gets wrong harmlessly: a metro written with the spaces in,
`Dallas / Fort Worth, TX`, is read as two places, and nothing short of a gazetteer distinguishes it
from `Boston, MA / New York, NY`. Both halves are real places a geocoder knows, they sit inside the
same metro, and the radius keeps a Posting when any place is in range — so a User near either half
keeps the role, which is what the unsplit reading would have given them.

`Truth or Consequences, NM` is the same reading in the same direction, and so is a fragment that
names nothing — `Tukwila, WA or short-term remote` yields Tukwila and a scrap. Splitting never drops
a Posting that would have survived: a part the geocoder cannot place is an unplaceable key, which is
what the whole string was, and one it places wrongly can only *keep* a Posting the unsplit reading
kept for everybody anyway.

The radius is not the only reader, though, and the scrap costs something on the way past. It becomes
a Geocode Cache key of its own, so the provider is called once for a string that names nothing; and
if it comes back with a point nearer the User than the real place, the COMMUTE DETAILS tab names
*that* one as the place it measured, because the tab names the closest (below). A distance to a
fabricated coordinate, labelled with the employer's own scrap. Telling a scrap from `Boston` or
`NYC` on the right of the word needs the gazetteer this rule does without, so the answer is the
census rather than a heuristic: across 12,252 Postings the word produced four such fragments
(`cst`, `short-term`, `within usa`, `availability`), against 54 Postings it placed properly. That is
the trade being made, not one being overlooked.

## Why (#113)

`Hybrid - San Francisco Bay Area, CA / Seattle, WA` normalized to the single key
`san francisco bay area, ca / seattle, wa`. No geocoder can place that, so the cache stored a
negative result and the radius — which drops a Posting only when it holds a resolved point that is
too far (ADR 0005, #12) — kept it. The Posting was then surfaced to every User at any distance,
permanently: re-running `pnpm warm-geocodes` could not help, because the string was unplaceable
rather than uncached. The report was a Bay Area/Seattle role reaching a User in Franklin, MA, whose
radius was 40 miles.

Keeping a Posting nobody could place is right and stays (CONTEXT.md, "Unresolved location"). What was
wrong is that this Posting *could* be placed — twice — and the codebase declined to read it.

## Which separators the rule takes (#119)

`or` is one. An employer joins two places with a word as readily as with a mark — `Denver, CO or
Menlo Park, CA`, `Herndon, VA OR Columbia, MD` — and those made exactly the key this ADR was written
about: unplaceable, so the radius kept the Posting for every User at any distance, forever. A census
of the Corpus on 2026-09-03, after the catch-up pass for the marks had run, found the three
separators shipped above had gone to zero and ` or ` had become the single largest remaining cause of
an unplaceable key naming perfectly findable places: 33 keys across 54 Postings, `palo alto, ca or
san francisco, ca` thirteen of them.

The word carries one trap the marks do not: `or` is Oregon's postal code. The rule reads it as the
state whenever it directly follows a comma, so `Portland, OR or Seattle, WA` splits once — between
the two places — and `Portland, OR` is not touched at all. What that costs is the Oxford comma:
`Reno, NV, or Batesville, IN` is not split, because nothing in the text distinguishes that `or` from
Oregon's. Both keys shaped that way in the Corpus are comma-separated lists that stay unplaceable
either way, and an unsplit text behaves as it did before this existed — the direction to be wrong in.

The aside now comes off the whole text **before** it is split, which the word forced and which was
already wrong for the marks. `Remote - US (East / Central)` was being broken into `us (east` and
`central)` — two strings the geocoder answered with a point that described neither, which is worse
than an unplaceable key, because a bad coordinate is measured and an unplaceable one is flagged. A
separator inside a bracket is not a separator. For the same reason a conjunction a preceding
separator stranded at the front of a place is dropped: `Seattle, WA; or New York, NY` names New York,
and `or new york, ny` is a string a geocoder will answer.

## The separators the rule does not take

Recorded so the next person meets a decision rather than a gap. Each was measured against the same
census.

- **`and`** — not taken. Zero occurrences in the Corpus, so this is a guess about tomorrow rather
  than a fix, and the rule is evidence-driven by design. It costs nothing to add later, on the day a
  key shows up wanting it.
- **`&`** — not taken. Two keys, three Postings, and they point opposite ways: `brentwood town &
  country, los angeles, ca` is one place whose *name* holds the ampersand, `san fernando valley &
  pasadena, ca` is two places. Evidence one-for-one against is a good reason not to guess.
- **A period between two places** — costed here when #119 shipped and then taken by #120, once the
  state-code table it needed existed. The section below has the rule and what it cost.

## A period between two places, and the state-code table (#120)

After #119's catch-up pass the period was the largest remaining shape by a distance: 32 keys across
55 Postings, two employers writing every office they have into one field — `Fort Wayne, IN.
Mooresville, IN.`, `Richmond, VA. Culpeper, VA. Herndon, VA.`, `Houston, TX. San Francisco, CA. Long
Beach, CA.` Each was one key no geocoder could place, so each Posting reached every User at any
distance wearing **Location unresolved** — #113's defect, reached by a third spelling.

A period is the comma's trap. It ends `St.`, `Ft.` and `Mt.` as readily as it ends a place, so
splitting on `. ` destroys `Lake St. Louis, MO`; and the obvious narrowing — a period after a
two-letter token that follows a comma, the shape every real example shares — still destroys `Plaza
at Frotenac, St. Louis, MO`, five Postings, because `St.` follows a comma exactly where `IN.` does.
Nothing in the *shape* of the text separates the two. What does is knowing that `IN` and `VA` are US
state codes and `St` is not.

So the rule is: **a period separates two places only when it follows a comma and a USPS state code**,
and the codes come from a table rather than a character class. The table (`src/postings/us-states.ts`)
lives beside the country classifier in `src/postings/`, and the classifier now builds its own
"state code after a comma" matcher from it instead of carrying a second copy inline — a US-only
Corpus (ADR 0010) is entitled to know its own states, and two readers should not each keep a list.
The table holds the fifty states and DC, and deliberately not the territories: adding `PR` or `GU`
would widen what the classifier calls `us`, which is a decision for a ticket that asks for it rather
than a side effect of moving a list.

The code is matched in capitals, exactly as the classifier matches it and for the same reason: a
state code is written `IN`, and `, in.` is as likely to be prose as Indiana. `The Jaydor Co. - East
Norristown, PA` stays one place because `Co.` is a company and only `CO` is Colorado. A text that
writes its codes in lowercase is not split, which is how it behaved before this existed — the
direction to be wrong in. The rule's own blind spot is a company suffix written in capitals after a
comma — `Acme, CO. Ltd` would read as Colorado and a scrap — which is the same scrap-on-the-right
cost #119 priced above; the census found no such text, so it is recorded here rather than guarded.

Two consequences of the rule's shape:

- **`Ft. Wayne, IN. Mooresville, IN.` reads as two places, not three.** `Ft` is not in the table, so
  the period after it is part of the name. Under the two-letter narrowing it was spared only by not
  following a comma — luck, not a rule.
- **A trailing full stop comes off every key, split or not.** The last place in such a list is
  written with the same period that separates the others, and without this it would have become
  `mooresville, in.` — a key nothing else in the Corpus shares. The strip is general rather than
  tied to the split, because `greater austin, tx.` and `usa.` were already keys in use, each a
  duplicate of one the cache already held. An initialism keeps its final period: `Washington, D.C.`
  is the spelling of the place, not the end of a sentence, and the strip leaves a period alone when
  another period sits one letter before it. The Dedup Key is unaffected either way — it drops all
  punctuation before it compares.

## A country named as the location names no place (#124)

`Remote - United States` normalized to `united states`, and the geocoder answers that key: 39.7837,
-100.4459, the geographic centre of the United States, a field outside Lebanon, Kansas. `Remote
(United States)` beside it normalized to null. Same employer, same meaning, opposite readings, and
the only difference was a bracket. A census of the Corpus on 2026-09-03, after #119's catch-up pass,
found 1,142 Postings held on a country-wide key — `united states` 659, `us` 275, `usa` 153, `u.s.`
41, `usa.` 10, all on that one field; `canada` 81, on a point in northern Saskatchewan; `north
america` 3 — and the texts behind them unambiguous: `Remote - United States`, `Remote US`, `Remote -
USA | Remote`, `Remote - U.S. Remote`.

A centroid is worse than no place. A Posting with no place is kept and, where it matters, flagged: the
User is told the radius could not judge it. A Posting on a centroid is *measured*, silently — dropped
for every User outside the radius of the field and kept for anyone inside it, whose COMMUTE DETAILS
tab quoted a straight-line distance and a drive time to that field, naming `United States` as the
place it measured (above). None of that was a judgement anybody made about the role. Constraining
the geocoder to the US (#122) does nothing here, because the centre of the US is in the US.

So a country, or a continent, named as the location is a **nationwide marker** and names no place
(`NATIONWIDE_MARKERS`, `src/postings/location.ts`), read exactly as a remote marker: the role can be
done from anywhere in the country, which is remote at the scale of a nation, and a country is not a
commute. `Remote - US`, `Remote, USA`, `USA Remote` and `Remote (United States)` now read alike —
remote, no place — and `Remote - United States / New Jersey / Boston / New York` reads as New
Jersey, Boston and New York, the country dropping out of the list. Because a nationwide marker is a
remote marker, these Postings read as naming only remote (`namesOnlyRemote`, #123) and wear no
**Location unresolved** pill: nothing was missed. `Hybrid - United States` is the exception the
remote markers already make — a hybrid role somewhere in the country withholds its place, and is a
miss.

The decisions the rule had to make, recorded so the next person meets them rather than a gap:

- **What counts.** The spellings the census evidenced: `united states`, `united states of america`,
  `us`, `u.s.`, `usa`, `u.s.a.` — the initialisms with their final period, since the trailing-full-stop
  strip above leaves an initialism's alone, and `usa.` already arrives as `usa` — and `north america`,
  a continent that reads the same way. Nothing the census did not produce is in the table. Matched against the whole of a part, never as a word inside one: `New York
  State, USA`, `Washington, DC` and `Undisclosed location, USA` are places whose names hold a country
  word, and still resolve.
- **A foreign country reads the same way.** `canada` is a place a geocoder places correctly — it just
  is not a commute. The country classifier (ADR 0010) already prunes a Posting whose location is only
  Canada; the 81 here named it beside US places, and the Saskatchewan point rode along with the real
  ones. The rule is "a country is never a Place", and the table holds the countries the census found.
  A country it did not find still reads as a place, which is what it did before this existed — the
  direction to be wrong in, and one the classifier has already pruned wherever the country stood alone.
- **A state does not — yet.** `massachusetts`, `texas`, `arizona` resolve to state centroids and have
  exactly the same shape of wrongness at a smaller scale. Out of scope here and recorded as its own
  ticket (#146): a state is at least in the right part of the country, so the census that decides
  whether "no place" or "the state" is the better reading for a User 30 miles from its centroid has
  not been taken, and this rule is evidence-driven by design.
- **The tested behaviour that changed.** `location.test.ts` asserted `normalizeLocation("Remote -
  US")` was `"us"`, deliberately, and `namesOnlyRemote("Remote - US")` was false for the same reason.
  Both are the other way now, and the cases say why rather than disappearing.
- **The Dedup Key** (ADR 0006) reads the whole text through the single-string normalizer, so `Remote -
  US`, `Remote - USA` and `Remote (United States)` now contribute the same empty location component
  and group — which is what that ADR already says every place-less Posting does. A text that names
  the country beside a separator, `Remote - USA | Remote`, still keys as `usa |` there, as it did
  before: the single-string normalizer never split, and this does not change what it strips.

**The cache held the bad rows.** `geocodes` had resolved coordinates for all seven keys, and stopping
the reader from producing them leaves the rows behind. `pnpm warm-geocodes` now drops every cache
row whose key the reader no longer produces (`forgetStaleGeocodes`, `src/operations/geocoding.ts`)
in the same pass that re-reads the Corpus — so the rows go as the Postings move off them, without
the full re-geocode `--refresh` costs. The test is "would the reader hand this key straight back",
deliberately not "does any Posting still name it": a home stated before #100 and never re-placed
still reads its point from this cache (ADR 0014), and no Posting need name `franklin, ma` for that
row to be somebody's home. The Corpus itself is brought up to date by `renormalizeLocations`, in the
nightly sweep and in the same script, without a re-Fetch.

## Why the closest place

A role offered in Boston and Seattle is a Boston role to somebody in Franklin, MA. That is the
distance that decides whether it is in range, so it is also the distance the COMMUTE DETAILS tab
quotes and the journey the drive times and the mapping link describe — a tab measuring to Seattle
would be explaining a decision nobody made. Because a User reading one distance against a location
naming two would take it for the only one, the tab says which place it is describing, in the
employer's own words.

With no home to measure from there is no closest, so the first place the Posting names is the one
named. The tab is showing user story 22's "state a home location" prompt at that point rather than
any distance.

## Why a list on the Posting rather than a child table

The places are derived, not stated: Extraction rewrites them from the location text, and a re-Fetch
clears them like every other derived column. A child table would give them a lifecycle of their own —
rows to insert, orphan and cascade — for a fact that is a property of one column of one row. The
cache stays keyed by string, so each place shares its `geocodes` row with every single-place Posting
that names it, and the funnel's distance stage becomes an array-membership test rather than a join
(indexed with GIN for it).

## Consequences

- **What "unresolved" means narrows again.** A Posting is unresolved only when *none* of its places
  resolved. One naming Boston and Seattle where only Boston geocoded was measured properly, and
  flagging it would announce a miss that did not happen. This is the third reading of that predicate
  (#12, #111, this) and it stays where #111 put it: `hasUnresolvedLocation` asks the radius's own
  scope rule and now takes "is any place resolved" as an answer the caller selected
  (`anyPlaceResolved`, `src/operations/geocoding.ts`) rather than a coordinate it joined.
- **A Posting whose only resolved place is too far is still dropped**, even if another place it names
  could not be geocoded. The rule is "every *resolved* place is out of range", which is the same rule
  a single-place Posting has always been read by.
- **The Dashboard and Posting page no longer join `geocodes`.** A Posting naming three places would
  come back as three rows and be counted as three openings; both reads take the boolean instead.
- **The existing Corpus needs no re-Fetch.** The migration carries each Posting's old key across as a
  one-place list, so nothing changes the moment it lands, and `renormalizeLocations` re-reads the
  location text already stored and splits it. It runs in the nightly sweep beside
  `reclassifyCountries` — the same "a fix to how text is read must reach the rows already stored"
  argument (#67) — and `pnpm warm-geocodes` runs it too, before it fills the cache, so a hand-run
  catch-up geocodes the places the Corpus will actually be measured on. Every Posting a Fetch still
  returns re-derives its places anyway, since a re-Fetch clears the derived fields; the pass is for
  the Expired ones and for the night before the next Fetch.
- **`normalized_locations` carries no index.** The question asked of it — "does the cache hold a
  resolved row for any of these keys" — is driven from the Posting and answered on the `geocodes`
  side by that table's primary key, so an index here would be on the wrong side of it. The btree the
  single key carried existed for the join this replaces.
- **The Dedup Key still reads the whole location text through the single-string normalizer**
  (ADR 0006). Two Postings are the same opening when they name the same places in the same words;
  nothing about grouping asked to be loosened here.
