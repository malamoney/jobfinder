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
- The COMMUTE DETAILS tab on the Posting page follows this scope too, since #112. It used to read
  the Posting's text alone, which put it out of step in both directions: a dual-tagged role was
  measured for a no-remote User and then offered them no screen saying how far away it was, while a
  role silent about where the work happens was given a tab for a User who accepts remote, whose
  radius had never measured it. Both now follow the rule above, so all three readers — the stage,
  the flag, and the tab — take this scope from the one statement in `radiusApplies`, each still
  deciding for itself when to ask at all: the flag only where a radius actually ran, the tab even
  for a User with no home to measure from. The narrowing has a cost worth naming: user story 19's "outside the radius" verdict is now read on a Posting the radius did
  measure, in the window before the next match run drops it, rather than on any far Posting that
  reached the User for another reason.
- No schema or data change. Matches are derived; the next match run (a Criteria save, the nightly
  sweep, or "Run matching now") applies the new scope.

## A location that names only remote is not one the radius failed to place (#123)

The flag's scope above says a Posting offering remote *is* unresolved for a User who does not accept
remote, "because they could only ever take it onsite". That holds when the text names an office and
the geocoder could not find it — `Bolt Farm - Whitwell, TN` — since that User would have to go there
and nothing says where. It does not hold when the text names remote and nothing else. `Remote
(United States)` has no office; there was never anything to place, and a pill saying the radius
could not place it announces a miss that did not happen — the same complaint ADR 0016 records about
a Posting where one Place of two resolved.

Verified on the development database, 2026-09-03, for a User whose Criteria were onsite and hybrid,
home Franklin MA, radius 50: of 97 Postings on the Dashboard, 9 wore the flag, and all 9 said `Remote
(United States)` or `Remote (New York)`. Every amber pill that User had was a remote role, and none
was a place anybody failed to find. The Arrangements did not help: each of the eight carried
`["remote", "onsite"]`, because Extraction reads the description and a remote role's description
says "onsite" often enough.

So the rule narrows once more, and this is the fourth reading of the predicate (#12, #111, #113,
this): **a location naming only remote is never unresolved, for any User**. The scope above is
untouched — the radius still measures everything for a no-remote User, and such a Posting is still
kept, unplaced, exactly as CONTEXT.md's "Unresolved location" says. What changes is what the User is
told about it.

Two decisions sit under that:

- **Where the distinction lives.** `normalizeLocation` knew why it returned null and threw it away,
  and its signature is load-bearing — it is on the Dedup Key path (ADR 0006), and the home location
  and the COMMUTE DETAILS tab read it too. So it keeps returning a key or null, and a second
  predicate, `namesOnlyRemote` (`src/postings/location.ts`), answers the flag's question. Both
  reduce the one reading of a part (`readPart`), so the text is read in one place and one pass, and
  every existing caller is untouched. The flag asks the predicate on the Posting's text, which it
  has in hand, rather than on the Arrangements, which the report above shows cannot answer it.
- **Which markers count.** The single set of strings that normalized to null is now two.
  `remote`, `fully remote`, `anywhere`, `work from home`, `worldwide`, `global` read as remote —
  there is no office. `various`, `multiple locations`, `n/a`, `tbd`, `unknown` read as placeholders
  — there is an office the employer did not name, which is a miss the User should be told about.
  `flexible` went with the placeholders deliberately: it as often means "any of our offices" as
  "from home", and flagging is the direction to be wrong in. A commute label with nothing after it
  — a bare `Hybrid` or `Onsite` — is a placeholder for the same reason, and so is any text naming
  remote beside a placeholder: `Remote / Multiple locations` and `Remote - TBD` still flag. A text
  naming a place is never only remote, whatever else it says; `Remote - US` names a country, and
  whether that country is a place is #124's question, which this had to land before.
