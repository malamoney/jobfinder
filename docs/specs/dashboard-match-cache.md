# The Dashboard's matched Postings, read once between the events that change them

Tickets: #154 (the split), #155 (the cache) — #155 is blocked by #154.
Follows `description-free-reads.md` (#138, #139), which cut what one Dashboard read carries;
this spec cuts how often the read runs at all.

## Problem Statement

Every render of the Dashboard reads the User's whole match list from the database: the Criteria
row, the radius in effect, a join of `matches` to `postings` (~2,245 rows for the primary
account, ~1 MB since #138), and the Review State marks. Nothing in that list changes between a
nightly Fetch Run and the next, or between one Criteria save and the next — yet the read runs
again on every filter tab, every "Back to matches", every Viewed / Saved / Applied click (each
ends in `router.refresh()`, deliberately, to keep the scroll position), every theme toggle and
Company icon resolution (both also `router.refresh()`), and every hot reload of `next dev`.

The one thing that does change between those events is the Review State — a handful of rows
keyed by Dedup Key that the User's own clicks write. The Dashboard read treats the two halves
as one: the half that changes nightly is re-read at the cadence of the half that changes per
click.

Neon meters network transfer, and the development environment still points at the production
endpoint (#140), so each of those renders is a megabyte against the same monthly allowance that
ran out on 2026‑09‑09. A cache does not fix #140 — that is an environment change — but once
#140 is done, this is what keeps the Dashboard's cost proportional to how often the match list
actually changes.

## Solution

Split the Dashboard read along the line the data already has, and cache the slow half.

- **The match list** — which openings match, the presented member of each Dedup Key group, the
  card facts, the matched and required Keywords, and whether the radius could place it — is read
  from the database only when something has changed it: the nightly sweep's match rebuild, a
  Fetch now, or the User saving their Criteria. Between those events it is served from the
  application's data cache, tagged so those three events can expire it precisely.
- **The Review State overlay** — Status, applied date, viewed flag, and the filter and counts
  that depend on them — stays a live read on every render. It is small, and it is the thing the
  User's own click just changed.

From the User's side nothing looks different: the list is the same, a Criteria save still shows
its new matches on the redirect, a click still marks the card. What changes is that a click, a
tab, or a back-navigation costs one small Review State read instead of the whole list.

## User Stories

1. As a User, I want the Dashboard to open quickly, so that reviewing matches does not wait on a database round-trip for a list that has not changed since last night.
2. As a User, I want switching between the Open / Saved / Applied / All tabs to be instant, so that filtering feels like filtering rather than reloading.
3. As a User, I want "Back to matches" to land where I left off with the Viewed tag updated, so that returning from a Posting is cheap and correct.
4. As a User, I want marking a card Viewed, Saved, Applied or Not interested to update the card without re-reading every match, so that each click costs what it changed.
5. As a User, I want the matches I see after saving my Criteria to be the matches for the Criteria I just saved, never a stale list, so that changing a keyword is trusted.
6. As a User, I want the Dashboard on the morning after a sweep to show last night's new matches, so that a cache never hides an opening the sweep found.
7. As a User, I want "Fetch now" to end with the Dashboard showing what it fetched, so that the button does what it says.
8. As a User, I want a Posting that Expired overnight to be marked Expired on the Dashboard the next morning, so that the cache does not keep a closed role looking open.
9. As a User, I want the "new today" and unreviewed counts to be right on every render, so that the summary is as trustworthy as the list.
10. As a User, I want a location that the radius could not place to lose its "unresolved" flag once it resolves, so that the flag clears at the next event that re-runs matching rather than lingering for weeks.
11. As a User, I want another User's Criteria save to leave my cached list alone, so that one account's activity never costs another's.
12. As a User with more matches than the cache can hold, I want the Dashboard to keep working — read from the database as it does today — so that a cache limit is a lost optimisation, never a broken page.
13. As the developer, I want the match list served from the cache to be byte-for-byte what the database would have returned, so that caching is invisible to every component that renders a card.
14. As the developer, I want to see in the development log whether a Dashboard render hit or missed the cache, so that I can tell the cache is working without reading Neon's transfer graph.
15. As the developer, I want the invalidation points to be the three events that change the match list and nothing else, so that a future change to Matching has one obvious place to look.
16. As the developer, I want the operations layer to stay free of the framework's cache API, so that the existing database-seam tests keep running unchanged.
17. As the developer, I want the cache to be exercised through a seam a test can drive with an in-memory cache, so that "a second read hits no database" is a test, not a belief.
18. As the developer, I want the decision recorded as an ADR, so that the next person who reaches for a different cache directive finds out why this one was chosen.

## Implementation Decisions

**Where the line falls.** The read splits into two operations. The first — call it the matched
Postings read — returns, per presented opening: the card facts (`DashboardPostingFacts`), the
matched and required Keywords, and the unresolved-location flag. It takes a User id and nothing
else; the filter is not an input, because the filter is a function of Review State. The second
— the overlay — takes that list and the User id, reads the Review State marks, derives
`status`, `appliedAt`, `viewed`, `expired`, the counts and the filtered, sorted `postings`, and
returns the `Dashboard` shape the page renders today. `readDashboard` becomes the composition
of the two and keeps its signature, so the page and every existing test are unchanged by the
split alone.

**What is derived live, not cached.** Anything that depends on the clock or the Review State is
computed in the overlay from cached facts: `expired` (from `absentFetches` / `expiresAt`),
`newTodayCount`, `unreviewedCount`, `status`, `appliedAt`, `viewed`, the filter and the sort.
The cached half carries facts only.

**The cache is the framework's data cache, through `unstable_cache`, not `'use cache'`.** This
is the decision worth an ADR. The Next.js docs in `node_modules` are explicit: `'use cache'`
stores in memory, and on serverless "cache entries typically don't persist across requests
(each request can be a different instance)" — on Vercel it would miss almost every time.
`'use cache: remote'` persists, but requires `cacheComponents: true`, which switches the whole
app to partial prerendering and Activity-preserved navigation — a rendering-model migration
this codebase has specific reason to fear (the scroll-restoration mechanism has broken three
times: #97, #98, #99, #142). `unstable_cache` persists across requests and deployments on the
platform's data cache, supports tags, and needs no config change. The docs mark it "replaced by
`use cache`" but it is documented, supported, and the previous-model guide still describes it;
the ADR records that if the app ever adopts Cache Components, the cache function is the one
place to change.

**Tags.** Every cached entry carries two tags: one per User (the Criteria-save event) and one
shared by all Users (the sweep event). Tag names are built by one function so the three
invalidation sites and the cache site cannot drift.

**The three invalidation points, and which primitive each uses.**

- *Criteria save* — a Server Action. Uses `updateTag` on the User's tag: the User is redirected
  to the Dashboard expecting their new matches, and `updateTag` is the read-your-own-writes
  primitive that guarantees the next read blocks for fresh data.
- *The nightly sweep* — the cron Route Handler, at the point where `drainAndRematch` reports
  nothing remaining (which is when `matchAllUsers` has run). Uses `revalidateTag` on the shared
  tag with `{ expire: 0 }`: `updateTag` is Server-Action-only, and the nightly change must not
  be served stale.
- *Fetch now* — the Server Action that starts a sweep does not invalidate, because the sweep it
  starts continues over further invocations and finishes in the Route Handler above. The
  Route Handler's invalidation covers both.

**Placement.** The cached wrapper and the invalidation calls live in the app layer, beside the
page, action and route that use them; `@/operations` stays free of `next/cache`, as it is
today. The wrapper takes the cache primitive as a parameter with `unstable_cache` as the
default, so a test can hand it an in-memory cache.

**Serialisation.** The data cache stores JSON. The matched Postings read returns a JSON-safe
shape — dates as ISO strings — and the overlay revives them, so what the page receives is the
same `Dashboard` type as today whether the list came from the cache or the database.

**Size.** The data cache refuses an entry over its per-item limit (the framework logs and
proceeds uncached). At ~2,245 openings the entry is well under it; at the Corpus the
corpus-breadth epic (#125) is aiming for it may not be. The read must degrade to a database
read — today's behaviour — and say so in the development log, never fail the page. The ADR
notes the limit as the reason the cached half carries facts only.

**Observability.** In development, one log line per Dashboard render says whether the match
list came from the cache or the database, and how many openings it held. Nothing in production
logs changes.

**Prefactor first.** The split is a pure refactor with no behaviour change and lands as its own
ticket, so the caching ticket starts from a read that already has the seam it needs.

## Testing Decisions

A good test here drives the seam from outside and checks what a User or the database sees:
the `Dashboard` the page receives, the number of times the matched Postings read reached the
database, and which events made it reach again. No test inspects tag strings or the cache's
internal keys beyond what the seam exposes.

- **The split** (operations layer, existing database-seam tests in `dashboard.test.ts` as prior
  art): `readDashboard` returns exactly what it returned before the split for the same rows —
  the existing tests are the regression guard. New tests pin the contract of the halves: the
  matched Postings read carries no Review State field and is JSON-round-trip stable; the
  overlay applied to a fixed list derives `expired`, counts and filter correctly.
- **The cache** (app layer, driven with an in-memory cache injected in place of
  `unstable_cache`): two reads for one User reach the database once; a Criteria save for that
  User makes the next read reach it again; a Criteria save for another User does not; the
  sweep's invalidation makes every User's next read reach it again; a review action changes the
  card's Status without the matched Postings read reaching the database; an entry the cache
  refuses falls back to a database read that still renders.
- **The invalidation sites** (the Criteria action and the cron route): a test that the action
  invalidates the User's tag and the route invalidates the shared tag once the sweep reports
  nothing remaining — prior art in the existing action and route tests, with `next/cache`
  mocked.
- **The generated SQL** test from #138 (`dashboardMatchQuery(...).toSQL()`) is untouched: the
  cached half is built on the same query.

## Out of Scope

- **#140 and #118** — the development database's environment and migration path. This spec
  reduces the cost of a render; it does not stop development renders from hitting production.
- **Adopting Cache Components** (`cacheComponents: true`, `'use cache'`, partial prerendering).
  Recorded in the ADR as the future migration path, not done here.
- **Caching the Posting page's read**, `readCriteria`, or `readLatestFetchRun`. Each is one
  small row; none is the cost.
- **Removing the `router.refresh()` calls** in the theme toggle and Company icon. With the
  match list cached they are cheap; whether they are necessary is a separate question.
- **Geocode-cache warm-ups run outside the app** (`pnpm warm-geocodes`). A location that
  resolves through the script clears its unresolved flag at the next matching event, not
  immediately; the script cannot reach the framework's cache and does not try to.
- **The match rebuild's own reads** (#139 landed those in SQL).

## Further Notes

- Ordering: land #140 first if possible. The overage is the environment; this is the ratio.
- The shared tag means one sweep expires every User's entry at once, and each User's next
  render repopulates their own. That is the intended shape: the sweep changed everyone's list.
- `revalidateTag` without a second argument is deprecated in this Next.js version; the route
  passes `{ expire: 0 }` explicitly and the ADR says why not `"max"` (a stale-while-revalidate
  window would show yesterday's list for one render after a sweep).
- If a future ticket moves the sweep's finish out of the Route Handler, the invalidation moves
  with it — the ADR names the three events, not the files.
