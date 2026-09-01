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
The identifier naming a Board within a Source, as it appears in that Source's URLs. For an
Aggregator, where there is no company to name, it names a slice of the feed instead — a USAJOBS
keyword, or just the feed itself.
_Avoid_: Handle, key, company ID

**Tenant**:
A Workday customer's careers instance, the Workday form of a Board. Unlike every other Board it
cannot be reached from its Slug alone: the hostname shard, the site name, and the keyword its jobs
are filtered to are configuration held by hand alongside the Slug (ADR 0003, `@/sources/workday-tenants`).
Workday charges a description request per job, so Tenants are a hand-picked short list, never harvested.
_Avoid_: Instance, account, org

**Aggregator**:
A Source that is one feed spanning many employers rather than one company's Board — USAJOBS,
Himalayas (ADR 0007). Too large to fetch whole in one Fetch, so its Postings expire by the close
date the feed publishes rather than by absence (ADR 0004 vs. 0007).
_Avoid_: Job board, index

**Corpus**:
The full set of Postings held in the database, fetched once and shared by all Users rather than
fetched per User. Holds only roles the location text places in the United States — a Fetch drops
the rest before storing them (ADR 0010).
_Avoid_: Index, cache, pool

**Fetch**:
One execution of the scheduled task that pulls Postings from Sources into the Corpus.
_Avoid_: Scrape, crawl, sync, import

**Extraction**:
Deriving normalized fields — salary, Arrangement, seniority, Country — from a Posting's free text
where the Source did not supply them structurally.
_Avoid_: Parsing, enrichment, cleaning

**Country**:
Whether a Posting's location text places the role in the United States: `us`, `non-us`, or
`unknown`. Classified from the location string on ingestion, and only `us` roles are stored
(ADR 0010) — so it reads `us` for every row a Fetch wrote, and `non-us` / `unknown` / null only on
rows stored before that policy, which the sweep's closing prune removes.
_Avoid_: Region, nationality, locale

**Source Key**:
A Posting's exact identity, being its Source paired with that Source's own identifier for it.
Re-fetching a Posting with a known Source Key updates it rather than inserting a duplicate.

**Dedup Key**:
A Posting's approximate identity across Sources, derived from normalized company, title, and
location. Postings sharing one are the same opening published in more than one place. Cheap and
deterministic — no fuzzy matching. Grouped Postings are all retained; the Dashboard presents one
(ADR 0006).
_Avoid_: Fingerprint, hash

**Representative**:
The one member of a Dedup Key group the Dashboard and Posting page show for the opening: a live
listing over an Expired one, then the fullest description, then the most direct apply URL, then
Source and Source id so the choice is stable. The group's Review State and matched Keywords are read
across every member, not just this one.
_Avoid_: Primary, canonical, winner

**Expired**:
A Posting that a Source stopped returning across consecutive successful Fetches. Retained rather
than deleted, so Review State outlives the listing.
_Avoid_: Dead, stale, closed, removed

**Geocode Cache**:
Normalized location strings paired with the coordinate each resolves to, keyed by the string rather
than the Posting — the same handful of strings recur across thousands of Postings. A negative result
is cached too; a geocoder outage is not (ADR 0005).
_Avoid_: Geo table, location index

**Unresolved location**:
A Posting that names a place no geocoder could place. Surfaced and flagged, never dropped — silently
dropping is how a User loses a role they wanted and never finds out. A remote Posting is not
unresolved: it names no place because it needs none.
_Avoid_: Ungeocoded, bad location, missing location

### Slug discovery

**Discovery**:
Finding the Slugs a nightly Fetch could cover, by harvesting Common Crawl for links to a Source's
Board hosts and reading the Slug out of each URL. Run by hand, nothing schedules it, and it writes
nothing to the Corpus (ADR 0008).
_Avoid_: Crawling, scraping, indexing

**Probe**:
Reading a candidate Board once to report what it lists — how many open roles, a sample of titles —
without letting its Postings into the Corpus. What turns a harvest of thousands into a list a person
can judge.
_Avoid_: Test fetch, dry run, check

**Curated set**:
The Boards a nightly Fetch actually covers: a per-Source seed file (`scripts/data/{source}-boards.ts`)
of Slugs each probed live before promotion, grown by hand from Discovery's ranked output. The
alternative to sweeping the whole harvested long tail (ADR 0003).
_Avoid_: Allowlist, whitelist, registry

### Fetch orchestration

**Fetch Run**:
One Fetch as a record: when it started, when the last of its Boards stopped being workable, and what
each Board did. It outlives any single function invocation. A Run is what a *sweep* of the Boards
means concretely; the two words describe the same thing, one as a record and one as an activity.
_Avoid_: Job, batch

**Fetch Task**:
One Board's place in a Fetch Run's queue, carrying its outcome — succeeded, or failed with a reason.
Only a succeeded Task is evidence that a Posting the Board did not return is gone (ADR 0004).
_Avoid_: Job, item, unit of work

**Worker**:
One invocation that takes Fetch Tasks from the queue and works them until its batch or its time
budget is spent. Never assumes it is alone, or that it will live long enough to finish the Run.
_Avoid_: Runner, processor, consumer

**Claim**:
A Worker's hold on a Fetch Task while it fetches that Board. A Claim older than the longest an
invocation may live is presumed dead, and the Task is offered to another Worker.
_Avoid_: Lock, lease, reservation

### Matching

**Criteria**:
A User's stated definition of the work they want: titles, keywords, Arrangements, location bounds,
and a minimum salary. Minimum salary excludes only Postings that *state* a salary below it;
Postings with no stated salary always pass. There is no country Criterion — the Corpus is US-only
by ingestion policy (ADR 0010), so every role a User could match is already US-based.
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

### Presentation

**Company icon**:
The small square mark shown for a Board's company in the corner of a Dashboard card. Resolved by
company name through Logo.dev and loaded straight from its CDN — never stored, and no sweep resolves
it, because the CDN is already the cache (ADR 0011). A company Logo.dev cannot place falls back to a
**monogram** — the company's first initial on a neutral disc — so a card never shows a broken image
or waits on the lookup. The apply URL cannot be used for this: it points at the applicant-tracking
host, whose favicon is the ATS's mark, not the company's.
_Avoid_: Logo, favicon, avatar, brand mark
