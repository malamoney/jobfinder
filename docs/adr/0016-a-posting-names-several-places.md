# A Posting names a list of places, and the closest one decides

A Posting's location text is read as the *list* of places it names rather than as one string. The
Corpus stores that list (`postings.normalized_locations`, a `text[]`), the Geocode Cache holds a row
per place as it always did, and the commute radius measures a User against the **closest** of a
Posting's places: it drops the Posting only when every place it could put on a map is out of range.

The splitting rule is deliberately narrow (`normalizeLocations`, `src/postings/location.ts`). A
semicolon or a pipe separates two places wherever it appears; a slash does only with whitespace
around it, because `Dallas/Fort Worth, TX` is one place. A comma never separates anything —
`Franklin, MA` is one place, and splitting on commas would destroy every location in the Corpus. A
text the rule does not split behaves exactly as it did before this existed, which is the direction to
be wrong in.

The one reading the rule gets "wrong" it gets wrong harmlessly: a metro written with the spaces in,
`Dallas / Fort Worth, TX`, is read as two places, and nothing short of a gazetteer distinguishes it
from `Boston, MA / New York, NY`. Both halves are real places a geocoder knows, they sit inside the
same metro, and the radius keeps a Posting when any place is in range — so a User near either half
keeps the role, which is what the unsplit reading would have given them.

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
