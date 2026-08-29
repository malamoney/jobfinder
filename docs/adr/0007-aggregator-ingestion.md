# Aggregator ingestion

ADR 0003 names USAJOBS, Himalayas, and The Muse alongside the ATS Boards. They are the same in the
shape they produce — a `SourcePosting` per opening, upserted on a Source Key — and different in
every operational assumption the Fetch machinery was built on. This records where they diverge and
why the divergence is contained to two things.

## An aggregator is not a Board

A Board is one company's listings, addressed by a Slug, and a single request returns all of it. An
aggregator is one feed spanning thousands of employers:

- **USAJOBS** — every federal posting, reached per *keyword*. A bare query is the whole federal
  service, so the curated set is a short list of keyword Slugs (`software-engineer`,
  `data-scientist`), and a Slug of `all` would ask for everything. Needs `USAJOBS_API_KEY` and
  `USAJOBS_USER_AGENT` in the environment.
- **Himalayas** — one remote-jobs feed, ~95,000 postings, newest first, paged by an opaque cursor.
  Nothing to address per company; the Slug just names the feed.

The `boards` table and the Fetch queue still model them as `(source, slug)` rows — a Fetch Task per
Slug, drained by the same Workers — because that machinery is about *scheduling work*, and an
aggregator Slug is a unit of work like any other. What changes is what a Worker does with the
result.

## Divergence 1: expiry is by published close date, not by absence

ADR 0004 expires a Posting after two consecutive successful Fetches omit it, because for a Board a
successful Fetch is the Board's entire current state. An aggregator Fetch is a **bounded slice** of
a feed far larger than one Fetch can pull — the newest N pages of Himalayas, the first M pages of a
USAJOBS keyword — so a Posting missing from a run is overwhelmingly just past the slice, not gone.

Both aggregator feeds publish each posting's own close date (`ApplicationCloseDate`, `expiryDate`).
So:

- `reconcileBoard` skips `countAbsences` for a Source whose adapter declares `expiry:
  "published-expiry"`. `absent_fetches` stays 0 for these Postings forever.
- The adapter sets `SourcePosting.expiresAt` from the feed's close date; it lands in the
  `postings.expires_at` column, refreshed from the Source on every re-Fetch like any other published
  field.
- `isExpired` returns true when `absent_fetches` has reached its threshold **or** `expires_at` is in
  the past. One function, both kinds of Source, so the Dashboard and dedup presentation need no
  awareness of which kind they are looking at.

ADR 0004's invariant is untouched for the Sources it governs: a failed aggregator Fetch still writes
nothing, and `expires_at` is only ever set from a successful one.

## Divergence 2: a longer fetch ceiling

A Board is one HTTP request; the default 20s ceiling is generous. An aggregator pages a feed —
Himalayas up to 20 requests, a USAJOBS keyword up to 10 — so `boardTimeoutFor` raises the ceiling to
a per-Source floor (35s) before the Worker caps it against its remaining batch budget. The Worker's
budget still wins wherever it is smaller, so a feed that pages cannot outlive the invocation working
it.

## What is bounded, and what is not

Each adapter caps its own request count (`MAX_PAGES`), so a feed's size cannot spend a Worker's
whole budget. Himalayas pulls the ~2,000 newest postings per run; a USAJOBS keyword pulls up to
5,000. Neither backfills the whole feed, and neither is meant to — the Corpus wants what has been
posted recently, and older postings age out by their close date whether or not a Fetch ever saw
them again.

The Muse is **not** in this ADR. Its page-99 cap and 500-requests/hour limit mean a working adapter
needs a slice cursor persisted across Fetch Runs and a request budget — structurally its own design,
tracked as its own issue rather than folded in here.
