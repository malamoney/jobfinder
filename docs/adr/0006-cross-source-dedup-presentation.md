# Cross-Source dedup presentation

The same opening is often published to more than one Source — a company's own Greenhouse Board and an
aggregator that re-lists it. Recorded once per Source, presented once (#2, user story 27).

## Two keys, already decided

The Source Key — Source plus that Source's own id — is exact identity and drives the ingestion upsert
(#5). The **Dedup Key** is approximate identity: normalized company, title, and location, joined.
It is deliberately cheap and deterministic, with **no fuzzy matching and no model** — no distance
metric, nothing learned. Company and title are case-, punctuation-, and accent-folded (`Zürich` →
`zurich`), and a fixed end-anchored list of company legal forms (`Inc`, `Ltd`, `Corp`, `Co`,
`GmbH`, …) is stripped so `Stripe, Inc.` and `Stripe` group. Two-letter national forms (`AG`, `SA`,
`AS`, …) are deliberately left in — as a bare final token they collide with ordinary names too
easily. A company that writes its name some other way, or a title off by a word, still produces two
groups; that is the accepted cost of a rule this blunt. The location component reuses
`normalizeLocation` (#12), so a listing that adds `/ Remote` to a city, and every place-less
listing, group as expected.

## Stored on the Posting, refreshed on re-Fetch

`dedup_key` is a column on `postings`, written by `dedupKey()` at ingestion and refreshed from
`excluded` on every re-Fetch alongside the other derived fields. It is not in `PRESERVED_ON_REFETCH`:
a company that corrected its name or place must regroup, not keep a stale key. The Dashboard groups a
User's Matches by it in memory; the Posting page looks a group up by it.

Migration 0012 backfills existing rows with a close-but-not-identical SQL approximation of the key
(no accent handling, a shorter legal-form list) so the column can be made `NOT NULL`. Every live
Posting's key is rewritten exactly on its Board's next Fetch, so any brief mis-grouping after deploy
is self-healing; there is no production data at the time of writing in any case.

## Retain every copy

Grouped Postings are **all kept** in the Corpus — none merged, none deleted. When one Source's
listing 404s, the others are still wanted (#7 expires them independently). Grouping is a
presentation concern layered over the shared Corpus, never a write to it.

## Presentation picks one member

`chooseRepresentative` orders a group by, in order:

1. **A live listing over an Expired one.** The spec's ordering (#13) names description and apply URL;
   live-vs-Expired leads them because "when one Source's listing 404s the others are still wanted" —
   showing the dead copy of an opening a User can still apply to is the worse failure, whatever its
   description looks like.
2. **The fullest description** — the richest of the group.
3. **The most direct apply URL** — an aggregator carries its real destination in a query string.
4. **Source then Source id** — so a group with nothing else to separate its members resolves to the
   same representative on every read.

With one Source live (#5) the description length is the operative signal — richer apply-URL
heuristics, and a real ATS-over-aggregator Source-trust signal, arrive with the aggregator Sources
that make them matter.

The openings are then ordered for triage by the **presented** listing's posted date (newest first,
no-date last), not by any group-wide aggregate — the order matches the card the User actually sees.

## Review State belongs to the opening, read across the group

A User's Status and Notes are read across the Posting's whole Dedup Key group — every member, not
only the ones currently in their Matches, since a marked listing can fall out of Matches (its
description diverged so a keyword stopped hitting) while a twin stays. Marking one Source's copy
shows on the page for any other copy and on the Dashboard card whichever member is presented. Writes
(`setStatus`, `setNotes`) still target the single Posting the User is looking at — the read is what
makes the group agree, which keeps writes simple and survives a re-Fetch that re-groups things. When
more than one member carries a mark (only possible after such a re-group), the most recently updated
one wins, being the User's latest word on the opening.
