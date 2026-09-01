# "United States only" Criteria, over a country derived from location text

> **Superseded by [ADR 0010](0010-us-only-corpus.md).** The sole User wants US-only roles as a
> standing fact, not a per-search choice, so the filter moved from a Matching stage to an ingestion
> gate: the Corpus now stores only `us` roles and the toggle is gone. The `country` classifier and
> the `us` / `non-us` / `unknown` vocabulary this ADR introduced are unchanged and still carry the
> decision — read below for why the signal lives in the location text and why `unknown` is treated
> like `non-us`.

A User can tick "United States only" in their Criteria. When it is on, Matching drops every Posting
whose location text does not place it in the United States — a role based abroad, a remote role,
and a role that names no place, all together.

## Why a derived field, and why in Extraction

No Source publishes a country. The signal is in the same free text every other location fact hides
in — `San Francisco, CA`, `Remote - US`, `London, UK`, `Remote` — so `country` is derived the way
`arrangements` and `normalizedLocation` are: a pure classifier (`@/postings/country`) run in
Extraction over the survivors of the cheap stages, cached on the Posting, cleared by a re-Fetch.
The three approaches that read a country off a *coordinate* were rejected: a remote role has no
coordinate, and a User who has not set a commute radius has geocoded nothing, so those approaches
answer for neither.

`extractCountry` returns one of `us`, `non-us`, `unknown`. `unknown` is overwhelmingly a bare
`Remote`.

## The departure this records

Every other derived funnel stage leaves a Posting alone when its text is silent on the axis — an
absent salary passes a floor, an unstated Arrangement is never rejected (`CONTEXT.md`, ADR 0001's
funnel). **The "United States only" stage does the opposite: it keeps only `country = 'us'`, so
`unknown` is excluded exactly like `non-us`.**

This is deliberate. A User who ticks "United States only" is not asking to be shown the roles that
*might* be American — they are asking for the ones that are, and `unknown` is the bare-`Remote`
role that is the whole reason they ticked the box. Treating silence as "keep" here would make the
filter do almost nothing on the Postings it most needs to act on.

## Consequences

- The classifier is a heuristic and will misjudge some strings — an all-lowercase `boston, ma`, a
  `Toronto, CA` that means Canada, a role in `Vancouver, WA` read as `Vancouver, BC`. It is tuned
  for the shapes ATS location lines actually take, and wrong calls are corrected by tightening the
  regexes, not by a schema change.
- `country` is null for every Posting extracted before this shipped. `extractPostings` re-derives
  when `country is null` (not only when `extracted_at is null`), so the Corpus fills in over the
  next few match runs rather than only on re-Fetch. Re-deriving the other fields from the same
  text is idempotent and a salary already on record is kept.
- USAJOBS Postings are US federal and classify `us`. Himalayas is a global remote feed whose
  Postings rarely name the US, so "United States only" empties most of Himalayas — which is the
  correct behaviour for a User who wants US-only roles.
- The stage is `derived` — it needs Extraction to have filled `country` for the cheap-stage
  survivors first, the same as the salary and Arrangement stages.
