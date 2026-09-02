# A User's home location is resolved onto their own Criteria, not through the shared cache

ADR 0005 put every location the commute radius needs through one path: normalize the free text to a
key, geocode the key, cache it in `geocodes` by that key. That covered a Posting's location and the
User's home together, because at the time they looked like the same problem.

They are not. A User's home location now takes its own path (#100): geocoded exactly as they typed
it, once, when they save their Criteria, and stored as a Home Coordinate on that Criteria row with
the Precision the geocoder graded the match at. Nothing about a home ever enters `geocodes`.

ADR 0005 still stands for Postings, unchanged.

## Why the shared path was wrong for a home

**The normalizer mangles addresses.** `normalizeLocation` is built for what an employer writes:
it strips parentheticals and a trailing "remote", which is right for `Austin, TX (Remote)` and
destroys `12 Beacon St (Apt 4), Boston, MA`. A User who typed their address had part of it deleted
before it was ever sent anywhere. The whole point of asking for an address is that it be geocoded
as given.

**The cache is shared.** `geocodes` is one table keyed by location string, read by every User's
match run. A city and state is a fine thing to pool — thousands of Postings say `Boston, MA`. A
street address is not: it identifies a person's home, it is looked up by exactly one User, and
pooling it buys nothing since nobody else will ever hit that key. Precision should not cost privacy.

**A home is asked for once and read constantly.** A Posting's location is one of thousands, geocoded
by a warm-up bounded per match run because there are too many to do at once. A home is one string per
User, known at the moment they press Save. Resolving it there is a single call on a path where the
User is already waiting, and it removes the home from the warm-up's budget entirely.

## What it costs

The point is resolved at save time, so it can be stale in a way a cache lookup could not: a save is
the only thing that re-asks, and only when the stated address changed or is not yet placed. That is
acceptable because the input only changes when the User changes it.

A geocoder that is unreachable at save time leaves the home unplaced. The save still succeeds — a
geocoder's ignorance must not lock a User out of their own search — and the radius simply does not
apply until a later save places it. Showing every role beats hiding a commutable one, which is the
same call ADR 0005 made for an unresolvable home.

## Consequences

- The commute radius measures from the Criteria row's coordinate. A row that reaches a match run
  without one — stated before this, or saved while the geocoder was unreachable — is placed by that
  run, outside its transaction where the external calls already are, so no row is left depending on
  the shared cache still happening to hold its home string. Until it is placed, the radius falls
  back to the old lookup, read-only, against whatever `geocodes` already holds.
  `pnpm resolve-home-locations` does the same for every stored row in one pass, without their Users
  re-saving.
- Nothing writes a home location into `geocodes` any more. `pnpm warm-geocodes` covers Postings only.
- The geocoder adapter now reports Precision alongside the coordinate, read from Nominatim's own
  `place_rank` grading rather than guessed from the shape of the input — "12 Beacon St" looks like an
  address whether or not any such address exists. The Criteria page uses it to tell a User plainly
  when what they gave only reached their city.
- The stored coordinate is cleared whenever the home location is cleared, so it cannot outlive the
  Arrangement selection that asked for it.
- The commute details on a Posting (#101) measure from this coordinate, which is what makes a drive
  time worth quoting at all.
