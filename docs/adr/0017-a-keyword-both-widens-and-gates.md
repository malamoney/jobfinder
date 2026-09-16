# A keyword has two modes: it widens the net, or it widens the net and gates it

A User's Criteria hold keywords in two arrays. `criteria.keywords` keeps the meaning it has always
had — a **widening** keyword adds to the `or` of the literal title-and-keyword stage of the
matching funnel (`titleAndKeywordMatch`, `src/operations/matching.ts`), so a Posting is surfaced
when a stated title occurs in its title or that keyword occurs in its title or description.
`criteria.required_keywords` holds the **required** ones. A required keyword joins that same `or`,
and then gets its own clause in a second cheap stage right after it (`requiredKeywordsPresent`)
that `and`s every required keyword together. A Posting survives the pair when (a stated title or
any keyword, of either mode, occurs in its text) **and** (every required keyword occurs in its
text).

Both stages read `postings.title` and `postings.description` only — Source-published text — so
the gate runs before Extraction and joins the geocode warm-up prefilter on the same basis as every
other cheap stage (ADR 0001). The match rule is the one the widening keyword already had: a
case-insensitive substring with `LIKE` wildcards escaped, so `c++` and `.net` match the text a User
meant and not a pattern.

## What this revisits

"Keywords widen the net rather than narrowing it" was written into the funnel and tied to #2, user
story 9: a role found by a keyword in its description is one a title list alone would have missed,
and a keyword that narrowed would have cost that catch. It was a settled reading, and it is not
wrong — it is incomplete. A User who added `TypeScript` and then saw a stack of roles with no
TypeScript in them was looking at Postings that matched on their title alone. The keyword did
nothing to hold them back because it was never able to, and the only lever left was a narrower
title, a blunt instrument for a requirement that is really about the body text (#135).

So the principle is not reversed; it is split. A keyword left in the default mode does exactly what
it did. What is added is a second mode a User has to choose, and the funnel doc-comment now
describes both.

## Why a required keyword still widens

The obvious reading of "required" is a pure filter: keep the `or` as it was, then drop anything
missing the word. That would let a required keyword *subtract* from what the same word did as a
widening keyword — a well-matched "Applied Research Scientist" role whose description says
TypeScript would be lost the moment the User marked TypeScript required, because no stated title
caught it and the word no longer pulled it in. Marking a keyword required is meant to add a
condition, never to remove reach the keyword already had. So it stays in the `or` and gains an
`and`; the common case of no required keywords is a stage that contributes nothing.

## Why two arrays and not a flag per keyword

The table already holds titles and keywords as Postgres arrays rather than child tables
(`src/db/schema.ts`): a User edits each as a set and Matching reads each as a set. A second array
keeps to that, and it keeps the first column's meaning untouched — every row saved before the
column existed is all-widening with nothing to backfill, which is what makes the upgrade silent
for a User who never touches the new toggle. The form (#136) presents the two as one toggled list;
`@/criteria/schema` splits a submission into the two arrays, dedupes within each, and dedupes
across them — a term arriving in both is kept as required and dropped from widening, since the
form prevents that state and the schema is only the backstop for a crafted POST.

## Consequences

- `matches.matched_keywords` keeps its meaning and now lists required keywords too, ahead of the
  widening ones — every required keyword is on a Match by construction, and the Dashboard marks
  them as the guaranteed hits (#137).
- The cross-source dedup union (`src/operations/dashboard.ts`) needs no change: every member of a
  Dedup Key group matched the funnel independently, so each contains every required keyword.
- Matches are derived; the next match run applies the gate. A User whose Criteria state no required
  keyword gets exactly the Matches they got before.
- Not in this decision: negative keywords ("must not mention"), boolean expressions between
  keywords, per-title requirements, or ranking by keyword count. Each keyword is still an
  independent literal substring, and the funnel is still a filter.
