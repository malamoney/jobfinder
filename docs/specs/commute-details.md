# Commute details on the Posting page

Tickets: #100 → #101 → #102 → (#103, #104)

## Problem Statement

A User who will only take work they can physically get to tells Jobfinder two things on the Criteria
page: roughly where they live, and how far they will travel. That is enough for the commute radius
to drop Postings out of range (ADR 0013), but it is all the User ever gets back. The answer is
binary — the Posting survived the radius, or it never appeared.

So a User looking at an onsite role in the Corpus cannot tell whether it is a twenty-minute run
against the traffic or an hour each way through a city. Twenty-eight miles of open highway and
twenty-eight miles of arterial road are the same number and not remotely the same job. The one
question that decides whether an onsite Posting is worth applying to is the one question the
Posting page does not answer.

The home location itself is part of the problem. It is asked for as a city and state, which is all
the radius needs, and it is then resolved through the normalizer built for a *Posting's* location —
which strips parentheticals and trailing "remote". A User who types a street address today has part
of it silently removed before it is ever geocoded.

## Solution

The review panel on the Posting page gains a second tab, **COMMUTE DETAILS**, beside the existing
**YOUR REVIEW**. On a Posting the User would have to travel to, it shows where they live and where
the role is, the routes between them drawn on a map, how long the drive typically takes in the
morning and again in the evening, and a link out to a public mapping service.

The Criteria page starts asking for a full street address rather than a city, and says plainly that
a city still works but leaves everything measured from it approximate. That address is resolved once
on save and kept as a coordinate with the User's own Criteria — which also makes the commute radius
itself more accurate, not just the new tab.

YOUR REVIEW is untouched. A remote Posting, or one with an Unresolved location, shows the review
panel exactly as it appears today, with no tab strip at all.

## User Stories

1. As a User who will not relocate, I want to see how long the drive to a Posting actually takes, so that I can tell a viable role from one I would resent within a month.
2. As a User comparing two onsite Postings at similar salaries, I want their commute times side by side, so that I can weigh the hours the job really costs me.
3. As a User, I want the morning and the evening drive shown separately, so that a role that is easy to reach and miserable to leave does not look easy.
4. As a User, I want to know the time I would have to leave home to be there for a 9am start, so that I can picture the actual morning.
5. As a User, I want the drive times labelled as typical rather than live, so that I do not mistake them for a forecast for the day I happen to be reading.
6. As a User, I want to see more than one route where one exists, so that I can tell a role served by a steady back road from one chained to a single congested highway.
7. As a User, I want to be told when the fastest morning route is not the fastest evening one, so that the number I remember is not the flattering half of the story.
8. As a User, I want the routes drawn on a real map, so that I can recognise the roads and judge the journey against what I already know of the area.
9. As a User, I want the map to follow the theme I chose, so that the Posting page does not flash a bright rectangle at me at night.
10. As a User, I want a link that opens the journey in a mapping service I already use, so that I can explore it properly without retyping two addresses.
11. As a User, I want to see my home location on the tab, so that I can tell at a glance which origin the times were measured from.
12. As a User, I want my home location to be read-only on the Posting page, so that I cannot change my whole search by mistyping into what looked like a scratch field.
13. As a User, I want a way through to the Criteria page from the tab, so that correcting my home location does not mean hunting for it.
14. As a User, I want to state my exact street address, so that the commute times are measured from where I actually live rather than from the middle of my city.
15. As a User who would rather not give a street address, I want a city to still work, so that the feature does not become a condition of using the product.
16. As a User who gave only a city, I want to be told that the result is approximate, so that I know why the number is soft and what would sharpen it.
17. As a User whose address cannot be found at all, I want my Criteria to save anyway, so that a geocoder's ignorance does not lock me out of my own search.
18. As a User, I want my exact address kept to my own Criteria rather than pooled where every User's lookups are shared, so that precision does not cost me privacy.
19. As a User, I want to know whether a Posting falls inside the radius I stated, so that I can see when something reached me for another reason.
20. As a User looking at a remote Posting, I want no commute tab at all, so that the page does not invent a journey I will never make.
21. As a User looking at a Posting whose location never resolved, I want the page to behave as it does today, so that a gap in the data does not become a broken screen.
22. As a User who has stated no home location, I want the tab to tell me what to do about it, so that an empty panel is not the whole answer.
23. As a User, I want the times to disappear rather than degrade into guesses when the routing provider is unavailable, so that I never act on a fabricated number.
24. As a User who navigates by keyboard, I want to move between the two tabs and know which is selected, so that the panel is usable without a mouse.
25. As a User, I want the Posting page to open as fast as it does today, so that a feature I did not ask for on this visit does not slow down the one I did.
26. As a maintainer, I want a journey looked up once and kept, so that a shared corpus of Postings in one metro does not multiply into a request per Posting.
27. As a maintainer, I want the routing provider reachable behind one seam, so that changing provider later is an adapter and not a rewrite.
28. As a maintainer, I want the feature to work with no routing key configured, so that a fresh clone runs without provisioning an account.

## Implementation Decisions

**Routing provider: TomTom.** Its free tier is 2,500 requests a day and needs no credit card, which
keeps the project's zero-provisioning stance. Google Routes was considered and rejected: it requires
a billing account with a card even inside its free tier, and traffic-aware requests fall into its Pro
tier (5,000 free calls a month).

**This sits beside ADR 0005, not against it.** That ADR chose keyless Nominatim for geocoding
because "a keyed provider would add a secret for no benefit at this scale". That reasoning holds for
geocoding and does not transfer to routing: no keyless engine returns traffic-aware durations, and
the whole value here is the difference between the 8am number and the 5:30pm one. A new ADR records
the routing decision alongside 0005 rather than superseding it.

**Public transit is out.** TomTom's free tier has no transit routing. The published design shows a
transit row; it is cut, and the route table is built to hold a third row so a later provider adds one
without a redesign.

**Drive windows are solved for arrival.** TomTom accepts an arrival time directly, so "be there for
9am" is one request rather than a guess-and-refine loop. The evening is anchored on departure at
5:30pm. Two requests per journey. Both read the provider's *historic* travel time, which is the
typical weekday median the design promises — not live traffic.

**Journeys are cached by origin-and-destination, not per Posting.** The same handful of location
strings recur across thousands of Postings — the observation the Geocode Cache was built on
(ADR 0005) — so the cache is keyed by the User's home coordinate paired with the Posting's
normalized location, and refreshed only once a stored result is old enough to have drifted. The
result is a request per distinct journey, not per Posting or per page view.

**The Home Coordinate moves onto the Criteria row.** Resolved at save time and stored with the
User's own Criteria, carrying how precisely it resolved. Two reasons: an exact street address should
not enter the Geocode Cache, which is shared by every User; and it removes the path where the home
location is run through Posting-location normalization, which is what currently mangles addresses.
Precision is read from the geocoder's own classification of what it matched, not guessed from the
shape of the input. Criteria stored before this change fall back to the old lookup, and a one-off
pass brings them up to date without the User re-saving.

**Which Postings are commutes.** A Posting whose location resolved to a point and whose Arrangement
is not remote. That is onsite and hybrid as asked, plus the Postings whose text names no Arrangement
but which the commute radius already measures — the same reading ADR 0013 settled. Everything else
renders the review panel exactly as today.

> **Superseded by #112.** This decision, and the summary above it, read the Posting's text alone —
> which turned out not to be "the same reading ADR 0013 settled". The tab now asks the radius's own
> question, scoped by the User's stance on remote: a User who does not accept remote gets a tab on
> every placed Posting, including a dual-tagged one; a User who accepts remote gets none on a Posting
> offering remote *or* on one silent about where the work happens. User story 20 is read as scoped to
> the User it was written about. The live statement is ADR 0013 and the **Commute** entry in
> `CONTEXT.md`; the rule itself is `radiusApplies` (`src/commute/radius-scope.ts`). Left standing
> here because a spec records what was asked for, not what the code went on to do.

**The map is real tiles.** The design canvas draws a schematic SVG captioned "not a street map",
which is a limitation of the canvas medium — a design canvas cannot load tiles — and its own turn
title says "route overlay on a real map". Built with a client-side map library over a keyless tile
provider offering both a dark and a light style, so it changes with the app's theme.

**Degradation is silence, never estimation.** No provider configured, provider unreachable, quota
exhausted: the tab keeps home, the Posting's location, the distance, the radius verdict and the
mapping-service link, and simply has no times and no drawn route. There is no interpolated or
multiplier-derived figure anywhere in the feature.

**The mapping-service link needs no key** and is built from coordinates, so it works regardless of
whether routing succeeded.

## Testing Decisions

A good test here asserts what a User would notice and nothing else: that a journey already looked up
is not looked up again, not which function performed the caching; that an unreachable provider still
renders the tab, not the shape of the error it threw.

**Prefer the seams that already exist.** Two do, and both are the highest available:

- **The operations seam.** The new read joins it beside the existing Posting and Criteria reads, and
  carries most of the behaviour: cache hit and miss, staleness, every reason the tab has nothing to
  show, and degradation when the provider is unreachable. Prior art: the existing Criteria, review,
  and matching operation tests.
- **HTTP, intercepted with MSW.** The routing provider is stood up the same way Nominatim and the
  Source adapters already are, so the adapter needs no injection and no new abstraction. Prior art:
  the geocoder is tested through the matching seam with MSW, never called directly.

**One new seam, and only one.** Pairing route alternatives across the two drive windows is fiddly
branching with no I/O — which route in the evening response corresponds to which in the morning, and
what to show when there is no counterpart. It gets a direct unit test, the way location
normalization does.

**Required regression coverage.** The commute radius changes where it reads the home coordinate
from. Tests must prove it still bounds correctly from the stored coordinate, and that Criteria saved
before the change still work through the fallback.

No component-render seam is introduced: the repo has none today, so new formatting logic is tested
as functions rather than through rendered output.

## Out of Scope

- **Public transit**, for the provider reason above.
- **Live traffic**, and any per-day or per-date forecast. The feature promises typical weekday times.
- **User-configurable drive windows.** 9am arrival and 5:30pm departure are constants; making them
  Criteria fields was considered and deferred.
- **Commute information on the Dashboard.** The tab is on the Posting page only; putting a time on
  every card would mean a lookup per card.
- **Commute as a matching criterion.** The radius still filters on great-circle distance. Filtering
  or ranking Matches by drive time is a much larger change to the funnel.
- **Walking, cycling, and multi-modal journeys.**
- **Any change to how Postings are fetched, extracted, deduplicated, or expired.**

## Further Notes

The design lives in the "Job Finder Theme Design" project in Claude Design
(`4df99e4c-fb58-419a-917a-8a874129c392`), artboards **4a/4b** for the Posting page with the tab strip
in place and **5a/5b** for the commute tab open, dark and light.

Two details in the artboards are deliberately not built as drawn. The transit row is cut, per the
decision above. The schematic map is replaced by real tiles, and the caption naming it a schematic
goes with it.

Cost, at the volume this feature implies: two requests per distinct journey, cached. Postings cluster
hard onto a handful of locations, so a single User working through a metro's Corpus touches on the
order of a hundred distinct journeys, against a free allowance of 2,500 requests a day. The free tier
is not a constraint worth designing around; the caching exists to keep the provider from being called
per Posting, not to ration a scarce budget.
