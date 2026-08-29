# Geocoding via Nominatim, cached by normalized location string

The commute-radius funnel stage (#12) needs a coordinate for a Posting's location and for the
User's home. Locations arrive as messy free text — `Greater Boston Area`, `San Francisco, CA /
Remote`, `Multiple locations` — so they are normalized to a lowercase, arrangement-stripped key
(`@/postings/location`) and geocoded through that key.

## Cached by string, not by Posting

The cache (`geocodes`) is keyed by the normalized string. The same handful of strings recur across
thousands of Postings, so geocoding per Posting would be thousands of external calls where geocoding
per distinct string is a few dozen. After a Corpus's first warm-up almost every lookup is a cache
hit and the geocoder is barely touched.

A negative result — the geocoder resolved a string to no place — is cached too, so an unresolvable
string is not retried on every Fetch. A geocoder *outage* is not cached: the adapter throws rather
than returning null, so no row is written and the string is tried again next run.

The cache is filled *before* a match run opens its transaction, on a plain connection. A first
warm-up geocodes many strings one per second (Nominatim's policy, `GEOCODER_MIN_INTERVAL_MS`);
holding the match transaction — and its locks on a User's `matches` rows — open across that would
be a mistake. What the warm-up cached is read straight back inside the transaction.

## Nominatim as the provider

Nominatim (OpenStreetMap) needs no API key and bills nothing. Its usage policy — one request per
second, a `User-Agent` that names the caller — is comfortably within what a string-keyed cache
demands. A keyed provider (Mapbox, Google) would raise the rate ceiling we do not approach and add
a secret to provision in CI and Vercel for no benefit at this scale.

If call volume ever outgrows Nominatim's policy, the provider is one adapter (`@/geocoding/nominatim`)
behind the `Geocoder` seam, swappable without touching the cache or the funnel.

## Consequences

- A Posting whose location cannot be geocoded is surfaced as unresolved and flagged in the UI, never
  dropped — the radius stage keeps it (CONTEXT.md, "Unresolved location").
- The radius applies to onsite and hybrid Postings only. A remote Posting, or one whose text names
  no location mode, is left alone — consistent with the Arrangement stage never excluding on a
  silent axis.
- If a User's own home location will not geocode, the radius stage is skipped entirely for them:
  showing every role beats hiding a commutable one.
- The "unresolved location" flag is shown only to Users who bound their search by distance — the
  only ones for whom a location was geocoded at all. For everyone else the geocode cache is empty
  by design, and an absent coordinate means nothing.
- A first distance-bounded match run over a cold Corpus is slow: it geocodes each new location a
  second apart before the Matches are computed. Steady state is cache hits. A future nightly
  Corpus-wide warm-up (part of #2's Fetch) removes even the first-run cost.
