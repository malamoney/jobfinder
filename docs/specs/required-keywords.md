# Required keywords on the Criteria page

## Problem Statement

A User states keywords on the Criteria page expecting them to say "only show me roles about this".
Jobfinder reads them the other way. A keyword *widens* the net: a Posting is surfaced when one of
the User's titles occurs in its title **or** one of their keywords occurs in its title or
description. It is an `or`, and the keyword half never constrains the title half. A User who adds
`TypeScript` as a keyword and then sees a stack of roles with no TypeScript in them is looking at
Postings that matched on their *title* alone — the keyword did nothing to hold them back, because it
was never able to.

That is deliberate and documented — "Keywords widen the net rather than narrowing it" is written
into the matching funnel (`src/operations/matching.ts`) and tied to #2, user story 9 — but it leaves
a User with no way to say the thing they most often want to say: *this role must actually be about
this*. The only lever they have is a narrower job title, which is a blunt instrument for a
requirement that is really about the body text.

The widening behaviour is worth keeping. A keyword that pulls in an "Applied Research Scientist"
posting a title list would have missed is exactly the catch #2 wanted. So the fix is not to change
what a keyword does — it is to let a User mark a keyword as one a Posting has to contain.

## Solution

The **Description keywords** field on the Criteria page gains a per-keyword toggle. Each keyword chip
is either **widening** (what a keyword does today — pulls in roles a title list would miss) or
**required** (a Posting is only shown if its title or description contains that word). A User adding
`TypeScript` and marking it required will never again see a Match without TypeScript in its text —
not even one whose title matched a stated title exactly.

A required keyword still widens the net as well: a Posting whose title matches nothing the User
stated but whose description contains every required keyword is still surfaced. "Required" adds a
gate; it does not remove the reach a keyword already has.

Keywords left in their default state behave exactly as they do now. A User who never touches the
toggle sees no change, and every Criteria statement saved before this feature keeps working
unchanged — its keywords are all widening.

On the Dashboard, a Match's card already shows which keywords were found in its text. A required
keyword that matched is shown there too, marked so a User can tell a guaranteed hit from a bonus
one.

## User Stories

1. As a User, I want to mark a keyword as one a Posting must contain, so that "about this" is
   something I can state instead of only hint at.
2. As a User who marked `TypeScript` required, I want every Match to contain TypeScript in its text,
   so that the keyword does the job I added it for.
3. As a User, I want a required keyword to exclude a Posting even when its title matched one of my
   stated titles, so that a perfect title cannot smuggle in a role that is about something else.
4. As a User, I want a keyword I leave alone to keep widening my search the way it does today, so
   that adding the feature does not cost me the roles a keyword currently catches.
5. As a User, I want a required keyword to still pull in a well-matched role my title list would have
   missed, so that "required" narrows what I see without also shrinking it.
6. As a User with several required keywords, I want a Posting shown only when it contains all of
   them, so that each one I mark is a real condition.
7. As a User, I want the required and widening keywords shown as one list I toggle between, so that I
   am not made to decide up front which box a word goes in.
8. As a User, I want my keyword settings to come back exactly as I left them when I reopen the
   Criteria page, so that I can trust what the form shows me.
9. As a User, I want saving a keyword change to re-match the whole Corpus like every other Criteria
   change, so that the Dashboard reflects what I just stated without my doing anything else.
10. As a User looking at a Match, I want to see which of my required keywords it contains, marked as
    required, so that I can tell a guaranteed hit from a widening one.
11. As a User with Criteria stated before this feature existed, I want them to keep working with no
    action from me, so that an upgrade does not silently change my results or lock my search.
12. As a User, I want the form to stop me marking the same word both required and widening, so that a
    contradiction is not something I can save.
13. As a maintainer, I want the required-keyword filter to read only fields a Source published, so
    that it runs in the cheap half of the funnel and costs nothing to recompute (ADR 0001).

## Implementation Decisions

**A keyword has two modes, and this revisits a documented principle.** "Keywords widen the net
rather than narrowing it" was a settled reading of #2, user story 9. Adding a gating mode is a
deliberate change to that, so the funnel's doc-comment is rewritten to describe both modes, and a
short ADR records the decision beside the funnel — the same way ADR 0013 records how distance bounds
read an Arrangement.

**Stored as a second array, not a flag on each keyword.** `criteria.keywords` stays `text[]` and
keeps its current meaning — every entry is a widening keyword. A new `required_keywords text[] not
null default '{}'` column holds the required ones. The migration touches no existing row's data, and
every pre-existing statement is therefore all-widening with nothing to backfill. The form presents
the two as one toggled list; `@/criteria/schema` splits the submission into the two arrays and joins
them back on read. This matches the table's existing choice of Postgres arrays over child tables
(`src/db/schema.ts`), and keeps the common case — no required keywords — a stage that contributes
nothing.

**A required keyword both widens and gates.** It is added to the `or` in the literal title-and-keyword
stage exactly like a widening keyword, *and* it gets its own clause in a new stage that `and`s every
required keyword. So a Posting survives when (a stated title or any keyword, widening or required,
occurs in its text) **and** (every required keyword occurs in its text). Marking a keyword required
never subtracts from the set a widening keyword would have caught — it only adds a condition.

**The new stage is cheap, not derived.** It reads `postings.title` and `postings.description`, both
Source-published, so it sits in the funnel right after the existing title-and-keyword stage and runs
in the pre-Extraction half. It joins the geocode warm-up prefilter (`warmGeocodesForMatch`) on the
same basis every other cheap stage does. `narrow` returns `undefined` when the User stated no
required keywords, the same guard `minimumSalary` uses.

**Same matching rule as today's keywords.** Case-insensitive substring against the title or the
description, with `LIKE` wildcards escaped — the existing `contains` helper, unchanged. `c++` and
`.net` match the text a User meant, not a pattern. A required keyword in the title alone counts, the
same haystack a widening keyword reads.

**The Dashboard marks required hits.** `matches.matched_keywords` keeps its meaning — the User's
keywords found in a Posting's text — and now includes required keywords, which by construction are
always present on a Match. The card's keyword tags gain a visual mark on the ones that are required,
so a User is not left guessing which tags were guaranteed. The cross-source dedup union
(`src/operations/dashboard.ts`) needs no change: every member of a group already contains every
required keyword, because each member matched the funnel independently.

**The form's chip component grows a toggle.** The `ChipField` used for **Description keywords** gets
a per-chip control that flips a keyword between widening and required, with the two states visually
distinct in the chip list. Titles are unaffected — that field keeps the plain `ChipField`. The
field's hint text is rewritten to explain the two modes in one sentence each. `CriteriaForm` holds
the keyword list as entries carrying a `required` boolean and splits them in `currentInput`;
`showStored` rebuilds that list from the two arrays a save returns.

**A word cannot be both.** `@/criteria/schema` dedupes within each array and also across the two: if
a term somehow arrives in both `keywords` and `requiredKeywords`, it is kept as required and dropped
from widening. The form prevents the state from arising; the schema is the backstop for a crafted
POST.

## Testing Decisions

The matching seam is where this behaviour lives and where it is proven — beside the existing
Criteria and matching operation tests (`src/operations/matching.test.ts`), which already stand up a
Corpus, save Criteria, and read the Dashboard.

**What the new tests assert:**

- A Posting whose title matches a stated title but whose text lacks a required keyword is **not**
  surfaced — the story-3 case, and the one a User is complaining about today.
- A Posting is surfaced when its title matches nothing but its description contains every required
  keyword — a required keyword still widens.
- With several required keywords, a Posting missing any one of them is excluded.
- A widening keyword still behaves exactly as the current tests say it does — the existing cases
  stay green unchanged, and a new case pins that a keyword left in the default mode does not gate.
- The Dashboard shows a matched required keyword, marked required, and the cross-source dedup union
  still lists it for every member of a group.

**Schema tests** (`src/operations/criteria.test.ts` / the schema's own tests): a keyword submitted
in both lists is normalised to required-only; `requiredKeywords` defaults to `[]` when omitted, so a
pre-feature client's submission still validates.

**Required regression coverage.** A Criteria row with an empty `required_keywords` column produces
exactly the Matches it produces today — a test that saves keywords with none marked required and
asserts the current widening result is unchanged. This is the guarantee that the upgrade is silent
for everyone who does not use the new toggle.

No component-render seam is added: the repo has none, so the form's split/join logic is covered as
functions if it is non-trivial, in keeping with how location normalisation is tested.

## Out of Scope

- **Negative keywords** — "must *not* mention". A separate feature with its own funnel stage; not
  bundled here.
- **Boolean expressions between keywords** — `TypeScript OR Go`, parenthesised groups, phrase or
  proximity matching. Each keyword is still an independent literal substring.
- **Per-title requirements** — attaching a required keyword to one job title and not another.
- **Ranking or sorting Matches by keyword count or relevance.** The funnel stays a filter; a Match
  is in or out.
- **Required keywords over structured or extracted fields** — company, Arrangement, salary text.
  The stage reads the title and description only, as the widening keyword does.
- **Any change to Fetch, Extraction, cross-source dedup, or expiry** beyond the one union note
  above, which is a no-op.
- **Multiple named searches.** Still one Criteria row per User (#2).

## Further Notes

There is no design artboard for this yet. The change is confined to the **Description keywords**
`ChipField` on the Criteria page and the keyword tags on the Dashboard card — both small surfaces. A
`DesignSync` pass against the "Job Finder Theme Design" project is worth doing for the toggle
affordance and the required-tag mark before the form ticket is built, so the two states read
clearly in both themes.

The word a User is most likely to reach for this with is a technology name — `TypeScript`,
`Postgres`, `Kubernetes` — which is also the case where a title match most often lies about what the
role is. The complaint that prompted this spec was exactly that: `TypeScript` marked as a keyword,
Matches with no TypeScript in them.
