# A United-States-only Corpus, enforced at ingestion

The Corpus holds only roles whose location text places them in the United States. `reconcileBoard`
classifies every role a Fetch returned with `extractCountry` and stores the `us` ones alone; a
`non-us` role and a `unknown` one (a bare "Remote", a role that names no place) are dropped before
the upsert — never written. The roles stored before this policy are removed by a bounded prune at
the end of each nightly sweep.

This supersedes [ADR 0009](0009-united-states-only-criteria.md), which made "United States only" a
per-User Matching stage over a shared Corpus that still collected foreign roles.

## Why move the filter to ingestion

The application has one User, and they do not want roles based outside the US — ever, not as a
per-search toggle. Under ADR 0009 every foreign role was still fetched, stored with its full HTML
description, matched against on every run, and then hidden. On Neon's 512 MB free tier that is a
third to a half of the budget spent on rows nobody will ever read. Himalayas (a global remote feed)
is mostly these; EU-hosted ATS Boards are these.

If foreign roles are never wanted, the cheapest place to reject them is before the insert, and the
rows already stored are dead weight to be cleared.

This is a deliberate departure from [ADR 0001](0001-shared-corpus-per-user-matching.md): the Corpus
is still fetched once and shared, and per-User Criteria still govern everything else, but it is no
longer collected "without regard for anyone's Criteria" — a single, standing geographic policy is
baked in. With one User whose stance is fixed, that trade is worth the storage.

## Dropping `unknown`, not just `non-us`

`extractCountry` returns `us` / `non-us` / `unknown`, and `unknown` is overwhelmingly a bare
"Remote" with no country cue. ADR 0009 already argued that a US-only filter should drop `unknown`:
someone who wants US roles is not asking for the ones that *might* be American. At ingestion the
cost of a wrong `unknown` drop is higher — the role is not stored until a later sweep, if ever,
re-classifies it — but the User's stance is unambiguous and the storage win is the point, so
`unknown` is dropped too. A company that later edits a bare "Remote" to "Remote - US" is ingested
normally on the next sweep.

The policy is one predicate — `extractCountry(location) === "us"` — not a knob.

## Expiry still holds

Only a *successful* Fetch of a Board is evidence that a Posting is gone
([ADR 0004](0004-expiry-by-absence-across-successful-fetches.md)). A Board that returned forty
roles of which thirty were foreign was still a successful Fetch of the ten US ones.

Absence is counted against the **US roles** the Board returned — the ones the Corpus keeps —
not the whole response. A foreign role was never stored, so it cannot be "absent" from anything.
A stored US role the Board still lists as US is in that set and is never counted absent. And a
stored `us` role whose company edits its location to somewhere abroad drops out of that set, so it
trends to Expired over the next couple of Fetches: hidden from the Dashboard, but the row — and any
Review State on it — is retained, exactly as ADR 0004 intends. It is not re-stored (it is no
longer a `us` role) and it is not eligible for the prune (its stored `country` is still `us`), so
Expiry is the mechanism that resolves it, and that is the right one.

## The prune

A role is deleted only when all three hold:

- its stored `country` is not `us` (foreign, placeless, or classified before ADR 0009 and still
  null — a null is classified from the same location text);
- no User has a Review State row for it — ADR 0004's "a role someone marked `applied` never
  vanishes from their tracker" still binds, and a Review State row *is* "a User acted on this";
- it fits within a per-invocation batch cap, so a first pass over a large backlog cannot overrun
  the 50-second drain budget. The rest waits for the next nightly run.

It runs in `drainAndRematch` once the queue is fully drained, **before** `matchAllUsers()` — so
the re-match never spends Extraction and matching effort on rows about to be deleted, and no
Dashboard read can catch a non-US role in the gap between the two. It is looped within a short
budget so a large first backlog clears in a night or two rather than one 500-row batch per night.
It sits beside where #52's long-Expired prune will go — ideally folded into one delete pass with
two conditions when that lands. A Dedup Key group needs no special handling: a `us` member is
never a candidate and a reviewed foreign member is kept, so a group never loses the member
carrying its Review State ([ADR 0006](0006-cross-source-dedup-presentation.md)).

## Consequences

- `country` is written on ingestion, like `dedup_key`, and reads `us` for every row a Fetch wrote
  after this shipped. Extraction still re-derives it (idempotent); the column is null only on
  pre-ADR-0009 rows until the prune or a match run classifies them.
- The `criteria.us_only` column, its Zod field, the form checkbox, and the `unitedStatesOnly`
  Matching stage are all removed (migration `0015`).
- A run summary carries `non_us_dropped` (roles the run's Fetches skipped) and `non_us_pruned`
  (already-stored roles the closing prune removed), surfaced by `readLatestFetchRun`. Only
  `non_us_pruned` is shown on the Dashboard, and only while it is non-zero — it is a one-time
  cleanup that trends to zero. `non_us_dropped` is a steady-state figure (the sources keep listing
  the same foreign roles every night), so showing it beside "last fetched" would read as news when
  nothing changed; it stays on the record for anyone who queries it.
- `extractCountry` is a heuristic (ADR 0009's consequences still apply) and will misjudge some
  strings. A wrong `non-us` call now means a role is never stored rather than merely hidden — the
  classifier is tuned conservatively for the shapes ATS location lines take, and wrong calls are
  fixed by tightening the regexes.
- Test fixtures default to a US location (`Remote - US`) so a test that does not care about country
  still gets a stored Posting.
