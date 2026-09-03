# Drive times from TomTom, cached by journey

The commute tab quotes two figures: the drive that arrives in time for a 9am start, and the drive
home leaving at 5:30pm (#102). Both come from **TomTom**'s Routing API, asked once per distinct
journey and kept in `commute_drives`, keyed by the User's Home Coordinate paired with the Posting's
normalized location.

The key (`TOMTOM_API_KEY`) is optional. With none set nothing is called and the tab shows the
straight-line distance, the radius verdict, and the mapping-service link with no times at all.

## This sits beside ADR 0005, not against it

ADR 0005 chose keyless Nominatim for geocoding, because "a keyed provider would add a secret to
provision in CI and Vercel for no benefit at this scale". That reasoning is about *geocoding*, and it
still holds there. It does not transfer to routing.

No keyless engine returns traffic-aware durations. OSRM's public demo server and Valhalla's free
instances route on free-flow speeds, which is the number that makes a twenty-eight-mile arterial
commute look like a twenty-eight-mile highway one — the exact confusion the tab exists to remove. The
whole value here is the difference between the 8am figure and the 5:30pm one, and only a provider
with historic speed profiles has it. So this is a benefit, and a key buys it.

Geocoding stays on Nominatim. Two providers, two decisions, each on its own merits.

## Why TomTom

**The free tier needs no card.** 2,500 requests a day, self-serve, no billing account. That keeps the
project's zero-provisioning stance: a fresh clone runs, and a contributor who wants drive times gets a
key in a minute.

**Google Routes was considered and rejected.** It requires a billing account with a card even inside
its free allowance, and traffic-aware requests fall into its Pro tier (5,000 free calls a month). A
card is a real barrier for a project anyone can clone; the allowance is not the reason.

**It solves for arrival directly.** `arriveAt` is a first-class parameter, so "be there for 9am" is
one request rather than a guess-and-refine loop that would double the cost of every journey.

**It resolves the journey's own time zone.** A moment sent with no UTC offset on it is read as local
to the end it anchors — the destination for `arriveAt`, the origin for `departAt`. So "9am" means 9am
where the role is, and the departure comes back with that zone's offset on it, without this codebase
ever owning a coordinate-to-time-zone lookup or a copy of the tz database. The server runs in UTC and
never needs to know better.

`traffic=false` is what makes the figures typical rather than live: TomTom always applies its historic
speed profile for the day and time asked about, and the flag turns off live incidents and closures —
precisely what a User must not mistake this number for.

## Cached by journey, not by Posting

The same observation the geocode cache rests on: a metro's Corpus is thousands of Postings across a
hundred-odd locations. Keying by Posting would turn one journey into a request per listing, and
keying by nothing at all would turn it into two requests per page view.

So `commute_drives` is keyed by `(origin, destination)` — the Home Coordinate written to five decimal
places, and the Posting's normalized location, which is the same key `geocodes` holds. A User working
through a metro touches on the order of a hundred distinct journeys against an allowance of 2,500 a
day. The cache exists to keep the provider from being called per Posting, not to ration a scarce
budget.

Rows carry `checked_at` and are refreshed once a month. Historic speed profiles move with roadworks
and new roads, which is months rather than minutes.

There is no `user_id` on the table. A journey between two points is the same journey for everybody,
and the origin is a coordinate rather than the address the User typed — ADR 0014's concern was the
*address*, which never leaves the Criteria row.

## Degradation is silence, never estimation

The rule the whole feature is built on: a drive time is a figure the provider gave us, or it is
absent.

- **No key configured** — nothing is called, no times.
- **Unreachable, refused, or out of quota** — the adapter throws, nothing is written, no times, and
  the journey is asked about again next time rather than remembered as unroutable. The same split
  ADR 0005 made between a negative result and an outage.
- **A journey it knows no route for** — a definite answer, cached as such so it is not retried on
  every page open.
- **Only one of the two windows answered** — no times. A User told the morning is forty minutes and
  shown nothing for the evening would read that as "the evening is fine", which is the asymmetry the
  two windows exist to expose.
- **A stored answer that has aged out, when the refresh fails** — the old figures stand. They are a
  measurement the provider gave us, not an estimate, and the alternative is a tab that empties
  because the provider happened to be down this minute.

The cache itself degrades the same way. `readDriveTimes` cannot throw: a row that will not read, or
a write that fails, costs the times and nothing else. The drive windows are the one thing on the
Posting page that is an extra rather than the point of the visit.

Nothing anywhere derives a drive time from the straight-line distance. `greatCircleMiles` measures the
line and the tab says in as many words that a driving route is longer.

## Consequences

- **The Posting page can make an external call.** Only on the first look at a given journey, bounded
  at five seconds a request with both windows asked in parallel, and never able to fail the page. A
  User opening a Posting in a place nobody has looked at yet waits for that; every subsequent open,
  by them or anyone else, is a cache read. This is the one thing #101 did not do, and it is what
  user story 25 is measured against.
- **The provider is one adapter behind one seam** (`@/routing/tomtom`), tested through the operations
  seam with MSW. Changing provider is an adapter, not a rewrite (user story 27).
- **Public transit is out**, because TomTom's free tier has no transit routing. The design canvas
  shows a transit row; it is cut, and #103's route table is built to hold a third row so a later
  provider adds one without a redesign.
- **Live traffic is out**, and so is any per-day forecast. The feature promises typical weekday times
  and says so on the tab.
- **The drive windows are constants** — 9am arrival, 5:30pm departure. Making them Criteria fields
  was considered and deferred.
- **The route alternatives (#103) and the drawn map (#104) build on this table.** Storing more than
  one route per journey is a column change here, not a new decision about the provider.
