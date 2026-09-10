# Reads that carry a description nobody shows

Tickets: #138, #139 — independent of each other, either can land first.
Alongside them, #140 — the environment configuration this spec puts out of scope.

## Problem Statement

On 2026-09-09 the project's Neon database exhausted its 5 GB monthly network transfer allowance and
began refusing connections. The Corpus is 12,252 Postings and 67 MB on disk. It was collected by a
single Fetch on 2026-09-02 — `fetch_runs` holds exactly one row, and every Posting's `first_seen_at`
and `last_seen_at` is that day. Ingestion moved roughly 70 MB, once. It is not where 5 GB went.

The Dashboard is. `readDashboard` (`src/operations/dashboard.ts`) asks for the whole Posting row:

```ts
.select({
  posting: postings,          // every column, including `description`
  matchedKeywords: matches.matchedKeywords,
  placed: anyPlaceResolved,
})
```

A `description` averages 4.2 KB of stored HTML. The primary account has 2,245 Matches, so one
render of the Dashboard pulls **21 MB of description text** across the wire, plus about 1 MB of
everything else. The second account, whose Criteria state one keyword, has 97 Matches and costs
958 kB. Five gigabytes is about **230 renders** of the first — a week of development, once every
page load, every filter tab, every `router.refresh()` from `RefreshMatches`, every
`revalidatePath("/dashboard")` in `dashboard/actions.ts`, and every hot reload of `next dev` is
counted.

Not one of those bytes is shown. The Dashboard card renders company, title, age, salary, location,
Arrangement tags and matched Keywords. It never renders a description; the full text lives on the
Posting page, which reads its own single row. The only thing in the Dashboard read that touches the
description at all is `chooseRepresentative` (`src/operations/dedup.ts`), which weighs
`b.description.length - a.description.length` to prefer the fullest listing in a Dedup Key group.
It needs a number, and it is given a megabyte-scale column to derive it from.

The match rebuild has the same shape. `matchCriteria` (`src/operations/matching.ts`) ends with
`tx.select().from(postings).where(full)` — every column of every hit — and uses two things from it:
`posting.id`, and `keywordsFoundIn(posting, stated.keywords)`, which lowercases the title and
description in Node to find which Keywords occur in them. That is the same 21 MB, moved to answer a
question the database was already answering one stage earlier: the funnel's own keyword stage
matched those Postings with `contains`, in SQL, without the text leaving the server.

This is a cost bug, not a behaviour bug. Nothing a User sees is wrong. But the shared Corpus was
built on the premise that recomputing everything is free (ADR 0001), and that premise quietly stops
holding when every recomputation ships the Corpus's largest column to the application to be ignored.

## Solution

Neither read carries the description any more.

The Dashboard read names the columns the card actually uses and asks the database for
`length(description)` instead of the text. `chooseRepresentative` weighs that number, so the
presentation rule is unchanged — the fullest listing still wins — but the thing it weighs travels as
four bytes instead of four kilobytes. One render of the primary account's Dashboard drops from
about 22 MB to about 1 MB.

The match rebuild computes matched Keywords in SQL. The funnel already has `contains`, the escaped,
case-insensitive substring test its keyword stage narrows on; the same helper builds an expression
returning the Keywords found in each hit, and the rebuild selects an id and that array. What the
Dashboard shows against a Posting and why the funnel surfaced it then agree by construction rather
than by two implementations of the same test agreeing on purpose.

Both changes are invisible. The same openings, in the same order, with the same representative,
the same Keywords, the same Status, the same counts.

## User Stories

1. As a User, I want the Dashboard to open quickly, so that triaging a morning's Matches does not
   begin with a wait.
2. As a User, I want switching between Open, Interested and All to be instant, so that filtering
   feels like looking rather than loading.
3. As a User, I want the same openings in the same order after this change as before it, so that a
   performance fix is not something I have to check up on.
4. As a User, I want the fullest of several cross-Source listings still chosen as the one I see, so
   that dedup keeps preferring the copy worth reading.
5. As a User, I want the matched Keywords on a card to stay exactly what they are today, so that the
   reason an opening reached me is still legible.
6. As a maintainer, I want the Dashboard read to carry only what the Dashboard renders, so that the
   largest column in the Corpus is not shipped to be discarded.
7. As a maintainer, I want the match rebuild to leave the description in the database, so that
   re-matching every User after a sweep costs what the funnel costs and not what the Corpus weighs.
8. As a maintainer, I want the Keyword hits computed by the same test the funnel narrows on, so that
   the card and the funnel cannot drift apart.
9. As a maintainer, I want the cost of a Dashboard read to be a property something asserts, so that
   the next column added to the Corpus does not silently reintroduce this.
10. As a maintainer, I want recomputing everything to stay genuinely cheap, so that ADR 0001's
    premise is still true of the code as well as of the design.

## Implementation Decisions

**`Presentable` weighs a length, not a text.** `chooseRepresentative`'s input type currently reads
`Pick<Posting, "description" | ...>` with the note "a stored `Posting` supplies all of it". It
becomes `descriptionLength: number` alongside the fields it already takes. A stored `Posting` no
longer satisfies it directly, which is the point: the type is what stops a future caller handing the
whole row over. It has exactly one non-test caller (`dashboard.ts`), so the ripple is small and
contained.

**`DashboardPosting` stops being `Posting & {...}`.** It is spelled out as the fields the card
consumes plus the fields the Dashboard adds. Every component downstream already takes a `Pick` —
`PostingTags` takes `Pick<Posting, "arrangements">`, the `format` helpers take their own narrow
picks — so the card compiles against a narrower type unchanged. The type is the specification of
what the Dashboard read must fetch; the `select` is written from it, not the other way round.

**The Dashboard still needs more columns than it renders.** `isExpired` reads `absentFetches` and
`expiresAt`; `hasUnresolvedLocation` reads `location` and `arrangements`; the "new today" window
reads `firstSeenAt`; grouping reads `dedupKey`; the representative tie-break reads `source` and
`sourceId`. All are small, all stay. `description` is the only column dropped, and it is 95% of the
payload.

**Keyword hits move into SQL by reusing `contains`.** Not a hand-rolled `ilike`, and not `strpos`:
`contains` already escapes the characters `LIKE` treats as wildcards, so `c++` and `100%` match the
text a User meant. Building the hit expression from the same helper is what makes agreement with the
funnel structural. The shape is one `case when contains(title, kw) or contains(description, kw) then
kw end` per stated Keyword, collected into an array with the nulls removed — bounded by how many
Keywords a User stated, not by the size of the Corpus.

**`keywordsFoundIn` goes away rather than staying as a second implementation.** Leaving a JS
substring test beside a SQL one is how the two drift. Its doc-comment's promise — that the card
cannot disagree with the funnel — is better kept by having one test.

**Extraction keeps its description select.** `extractPostings` reads the text because it derives
salary and Arrangement from it. It is scoped to rows with `extracted_at is null or country is null`,
so on a settled Corpus it reads nothing. Untouched here.

**The Posting page keeps its full row.** `readPosting` selects `posting: postings` for one Posting
and renders the description. That is a single row and exactly what it is for.

## Testing Decisions

The operations seam is where this lives and where it is proven, beside the existing tests
(`src/operations/dashboard.ts` is covered through `matching.test.ts` and
`cross-source-dedup.test.ts`, which stand up a Corpus, save Criteria and read the Dashboard).

**Behaviour must be pinned before it is preserved.** Most of what these changes must not break is
currently asserted only incidentally. The tickets add the missing cases first:

- A Dedup Key group whose members differ only in description length presents the longest — the
  `chooseRepresentative` rule, asserted directly rather than through a fixture that happens to
  exercise it.
- The `isExpired` half of that tie-break still beats description length: a long Expired listing
  loses to a short live one.
- The matched Keywords on a card are exactly the Keywords occurring in the presented listing's title
  or description, including the union across a Dedup Key group.
- A Keyword containing `%`, `_` or `\` is found literally, on the card as well as in the funnel —
  the `contains` escaping, now load-bearing in a second place.
- A Keyword differing in case from the text is still reported as found.
- The Dashboard counts — matched, unreviewed, interested, not interested, applied, new today — are
  unchanged for a fixed Corpus and Criteria.

**A regression test for the cost itself.** The point of the change is a property, so something has
to hold it: an assertion that the Dashboard read does not select `postings.description`. Cheapest
honest form is against the generated SQL — Drizzle's query builder exposes `.toSQL()`, so the
Dashboard's select can be built and its text asserted not to name the column. A test that only
checks the rendered output would pass just as well with the column back in.

**Existing tests stay green unchanged.** They assert what a User sees, and no User-visible thing
changes. Any test that needs editing is a test that was reaching for `description` on a Dashboard
row, which is itself the finding.

## Out of Scope

- **Paginating the Dashboard.** 2,245 rows still come back to render a screenful of cards, and the
  Status filter is still applied in JS after the pull. Both are worth doing and neither is this: one
  is a change to what the Dashboard is (#9's "every Posting matching the Criteria, on one page"),
  and after these tickets the payload is ~1 MB rather than ~22 MB.
- **Pushing the Dedup Key grouping into SQL.** Same reasoning. The grouping is in memory because the
  presentation rule is; moving it is a separate design question.
- **Repointing local development away from the production database (#140).** `.env.local` names the
  pooled production endpoint, which is what turned every hot reload into a Dashboard read against
  the live database. That is the multiplier behind the overage, and it is a documented convention
  the local file diverged from — `.env.example` prescribes a local Postgres and the README describes
  `DATABASE_URL` as a dev database. Note that a Neon dev *branch* would not fix it: the allowance is
  billed per project, so a branch draws on the same 5 GB. It is environment configuration, not
  application code, and no agent can do it.
- **Anything about the Fetch, Extraction, expiry, dedup semantics, or the funnel's stages.** The
  funnel narrows on exactly what it narrows on today.
- **Reducing what a description costs to store.** Compressing or truncating the column, or moving it
  out of the row, is a different change with different consequences for the Posting page.
- **Query-level instrumentation or a transfer budget in CI.** Worth considering later; the property
  test is the cheap version.

## Further Notes

**The measurements, taken 2026-09-09 against production.** 12,252 Postings; `description` averaging
4,237 bytes stored and summing to 50 MB compressed on disk; `postings` 67 MB total; 2,342 rows in
`matches` across 3 accounts. Per-account Dashboard payload: 2,245 Matches → 21 MB of uncompressed
description text, 22 MB in total; 97 Matches → 958 kB. `pg_column_size` reports the TOAST-compressed
size, so the on-the-wire figure is the larger `octet_length` one quoted here.

**Why the primary account is so expensive.** Its `criteria.keywords` is empty, so the funnel's
keyword stage narrows on nothing and 2,245 of 12,252 Postings match. That is a real use of the
product, not a misconfiguration, and it is the case the read has to be cheap for.

**A smaller thing found alongside.** `extractPostings` scopes on `extracted_at is null or country is
null`. The `country` half is derived from `location` alone, so a row picked up only because its
`country` was never classified has its whole description read for nothing. On a Corpus where country
has been backfilled this is zero rows, and it was not a contributor to the overage. Worth a look if
Extraction ever shows up in a transfer bill.
