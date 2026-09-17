# `unstable_cache` for the Dashboard's matched Postings, not `use cache`

The matched Postings read (#154) changes only at a match rebuild or a Criteria save, yet every
filter tab, every "Back to matches", every Viewed / Saved / Applied click, every theme toggle and
Company icon resolution, and every `next dev` hot reload re-ran it — a ~1 MB read against Neon,
which meters transfer, and which the development environment still points at production for (#140).
#155 stores that read between the events that change it. The question this ADR settles is which of
Next's two data-cache mechanisms holds it.

`'use cache'` was the first candidate — it is where the framework's own docs point, and it needs no
extra import. The docs in `node_modules` are explicit about what it actually does, though: it stores
in memory, and on serverless "cache entries typically don't persist across requests (each request
can be a different instance)". Vercel's Functions are exactly that — on a cold instance `'use cache'`
would miss almost every time, which is the failure this ticket exists to fix, not a way to fix it.

`'use cache: remote'` does persist, on the platform's data cache rather than in memory, but it
requires `cacheComponents: true` in `next.config.ts`. That flag is not a caching toggle; it switches
the whole app's rendering model to partial prerendering with Activity-preserved navigation. This
codebase has a specific, repeated reason to fear that migration: the matches-list scroll-restoration
mechanism (`matches-return.ts`) has broken three times already — #97, #98, #99, #142 — each time
because something in the render/navigation pipeline changed underneath it. Adopting Cache Components
to cache one read is trading a transfer-cost problem for a second shot at a bug class that took four
tickets to close the first time.

`unstable_cache` persists on the platform's data cache across requests and deployments, the same
storage `'use cache: remote'` would use, supports tags, and needs no config change — no
`cacheComponents`, no rendering-model migration. It is marked "replaced by `use cache`" in the docs,
but it is still documented, still supported, and the previous-caching-model guide still describes it.
That is the trade this ADR makes: give up the newer directive's ergonomics to keep the rendering
model the scroll-restoration fix depends on.

## Decision

Cache the matched Postings read with `unstable_cache`, tagged per-User and shared-across-Users
(`src/app/dashboard/matched-postings-cache.ts`), invalidated by exactly three events:

- a Criteria save — `updateTag` on the User's own tag, from the Server Action, for read-your-own-
  writes;
- the nightly sweep, at the point `drainAndRematch` reports nothing remaining (which is when
  `matchAllUsers` has already run) — `revalidateTag` on the shared tag, from the cron Route Handler,
  with `{ expire: 0 }`. Not `"max"`: a stale-while-revalidate window would serve yesterday's list for
  one render after a sweep that just changed it, which is the one moment staleness is worst;
  `revalidateTag` with no second argument is deprecated in this Next.js version.
- "Fetch now" — nothing of its own. Its sweep finishes through the same function the cron route
  hands off to, whether in one invocation or several, so the Route Handler's invalidation covers it.

The wrapper and both invalidation calls live in the app layer, beside the page, action and route that
use them. `@/operations` stays free of `next/cache`, as it was before this ticket, so its existing
database-seam tests keep running unchanged. The cache primitive is a parameter of the wrapper,
defaulting to `unstable_cache`, so a test drives the seam with an in-memory stand-in instead.

## Consequences

- Only the matched Postings read is cached. The Review State overlay — Status, applied date, viewed
  flag, the counts and the filter derived from them — stays a live read every render: it is small,
  and it is the thing a User's own click just changed. `expired` is derived live from cached facts
  too, since it depends on the clock, not on when Matching last ran.
- The data cache refuses an entry over its per-item size limit. In production `unstable_cache` warns
  and proceeds uncached; in `next dev` it throws instead, once the wrapped read has already produced
  a value (Next's `IncrementalCache.set`, error `E1003`). `readMatchedPostingsCached` catches that
  throw and falls back to the value the read just produced, so the page never fails either way — a
  property of the cached half carrying facts only (#138). The size the ADR expects this to matter at
  is the Corpus-breadth epic (#125), not today's ~2,245-opening account.
- The cached facts are read once between invalidations; anything computed from them and the clock —
  `chooseRepresentative`'s live-over-Expired tie-break among a Dedup Key group's members — can now
  only change at the next invalidation rather than on every render. Identical to today's behaviour
  between two events that already invalidate it; the nightly sweep tag will usually mask the case
  where a Representative flips mid-window on its own.
- If the app ever adopts Cache Components, `src/app/dashboard/matched-postings-cache.ts` is the one
  place to change: swap the wrapper's body for a `'use cache: remote'` function carrying the same two
  tags, and the invalidation sites are untouched (they call `updateTag` / `revalidateTag` by tag name,
  not by cache mechanism).
