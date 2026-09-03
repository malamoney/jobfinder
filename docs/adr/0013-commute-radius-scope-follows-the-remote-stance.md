# The commute radius applies to everything unless the User accepts remote

The commute-radius stage of the matching funnel (`withinCommuteRadius`, `src/operations/matching.ts`)
now scopes itself by whether the User's Criteria accept remote work:

- **User accepts remote.** The radius is left off any Posting whose text offers remote, and off any
  Posting silent on its location mode — unchanged from before, and the same "do not exclude on a
  silent axis" rule the Arrangement stage follows.
- **User does not accept remote** (they ticked only onsite and/or hybrid). Every Posting with a
  resolved location is measured against the radius. A Posting silent on its location mode is not
  given the benefit of the doubt here: it has an address, that address geocoded, and the User asked
  for work they can get to.

A Posting whose location will not geocode is still kept and flagged unresolved, either way — #12's
"never silently drop a role the User might have wanted" still binds.

## Why change it (#73)

The stage used to bite only on a Posting whose text explicitly said `onsite` or `hybrid` (and not
`remote`). Everything else — a Posting that named no location mode, or one that offered remote —
skipped the radius entirely.

Arrangement Extraction is a regex over free text and misses often: plenty of onsite roles never
write the word "onsite". So a User who set "onsite or hybrid, within 40 miles of Franklin, MA" got
a Dashboard full of roles in Austin, Costa Mesa, and Fort Lauderdale — every role whose text
happened not to state its location mode, from anywhere in the country. The location filter, the
main thing that User was asking for, did almost nothing.

The location string is the reliable signal, not the arrangement text. If a role is in Austin and
its text never says "remote", it is an Austin role — whether or not it also says "onsite". For a
User who will not work remotely, that is the whole question.

## Why the remote stance is the switch

A User who accepts remote genuinely does not care where a silent-on-arrangement role is based —
worst case they do it from home. Measuring every such role against their radius would wrongly drop
remote-friendly roles that don't spell out "remote". So the old lenient behavior is exactly right
for them and is kept.

A User who does not accept remote has no such fallback. Every role is a commute, so every resolved
location is measured. The two readings do not need reconciling because they are answering different
questions.

## Consequences

- A Posting that offers remote is now excluded for a no-remote User if its location is out of range
  — previously the "offers remote" clause let it through. That role was only ever takeable by that
  User onsite, at a place they cannot reach, so this is correct.
- The transient window while a Fetch's new locations are still being geocoded (ADR 0005, bounded
  per run) now also covers silent-on-arrangement roles: they show unfiltered until their location
  resolves, then drop if it is far. `hasUnresolvedLocation` at first still only flagged roles whose
  text placed them onsite/hybrid, so a silent or remote-tagged role in that window showed without
  the amber flag. #111 closed that: the scope rule above is now stated once
  (`radiusApplies`, `src/commute/radius-scope.ts`) and read both as SQL by the stage and as a plain
  boolean by the flag, so the pill lands on exactly the Postings the radius could not place.
- No schema or data change. Matches are derived; the next match run (a Criteria save, the nightly
  sweep, or "Run matching now") applies the new scope.
