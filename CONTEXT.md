# Jobfinder

A web application that fetches job openings on a schedule, filters them against a user's stated
criteria, and presents the matches for review.

## Language

### Postings and sources

**Posting**:
A single job opening as published by a Source, holding only facts that came from that Source or were
derived from them by Extraction. Never carries a user's opinion of it.
_Avoid_: Job, listing, ad, req

**Source**:
An external system Postings are fetched from. Each Source is reached through its own adapter.
_Avoid_: Provider, board, site, feed

**Board**:
One company's job listings within an applicant tracking Source, addressed by its Slug.
_Avoid_: Careers page, company feed

**Slug**:
The identifier naming a Board within a Source, as it appears in that Source's URLs.
_Avoid_: Handle, key, company ID

**Corpus**:
The full set of Postings held in the database, fetched once and shared by all Users rather than
fetched per User.
_Avoid_: Index, cache, pool

**Fetch**:
One execution of the scheduled task that pulls Postings from Sources into the Corpus.
_Avoid_: Scrape, crawl, sync, import

**Extraction**:
Deriving normalized fields — salary, Arrangement, seniority — from a Posting's free text where the
Source did not supply them structurally.
_Avoid_: Parsing, enrichment, cleaning

**Source Key**:
A Posting's exact identity, being its Source paired with that Source's own identifier for it.
Re-fetching a Posting with a known Source Key updates it rather than inserting a duplicate.

**Dedup Key**:
A Posting's approximate identity across Sources, derived from normalized company, title, and
location. Postings sharing one are the same opening published in more than one place.

**Expired**:
A Posting that a Source stopped returning across consecutive successful Fetches. Retained rather
than deleted, so Review State outlives the listing.
_Avoid_: Dead, stale, closed, removed

### Matching

**Criteria**:
A User's stated definition of the work they want: titles, keywords, Arrangements, location bounds,
and minimum salary. Minimum salary excludes only Postings that *state* a salary below it; Postings
with no stated salary always pass.
_Avoid_: Filters, preferences, settings, query

**Match**:
The verdict that a Posting satisfies a User's Criteria, carrying the Keywords that hit. Derived, and
discarded and recomputed when Criteria change.
_Avoid_: Result, hit, recommendation

**Arrangement**:
How the work is performed: full-time, part-time, remote, onsite, or hybrid. Distance bounds apply to
onsite and hybrid Postings; remote Postings ignore them.
_Avoid_: Type, mode, work style, job type

### Review

**Review State**:
A User's relationship to a Posting: its Status, their Notes, and when each was set. Owned by the
User and never recomputed.
_Avoid_: Bookmark, flag, interaction

**Status**:
Where a Posting sits in a User's review pipeline: `new`, `interested`, `not_interested`, or
`applied`. Exactly one at a time.
_Avoid_: Favorite, bookmarked, starred, saved, archived
