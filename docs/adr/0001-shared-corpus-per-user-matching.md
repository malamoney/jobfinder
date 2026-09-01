# Shared Corpus, per-User matching

The scheduled Fetch pulls a broad sweep of Postings into a single shared Corpus without regard for
anyone's Criteria, and each User's Criteria are then applied as a query over that Corpus. It would
be more obvious to search each Source directly using a User's Criteria, but Source rate limits are
per-key and low — Adzuna allows 2,500 calls per month, Jooble 500 for the lifetime of a key — so
per-User search makes Source cost scale linearly with signups and exhausts those budgets at
roughly twenty users. Fetching once into a shared Corpus makes Source cost a function of how many
Boards we track, independent of how many people use the app.

## Consequences

- Matches are derived data. Changing Criteria invalidates them, which is why re-matching is a
  first-class operation rather than something that only happens at Fetch time.
- A User can only ever see what the last Fetch collected, so "Run Now" cannot mean "search the
  sources for me right now" without reintroducing the per-User cost this decision avoids.

## Amendment (ADR 0010)

The Fetch is no longer entirely Criteria-blind. [ADR 0010](0010-us-only-corpus.md) bakes in one
standing geographic policy — the Corpus stores only US-based roles — because the sole User's
"US only" stance is fixed and storing the roles they will never see wastes the free-tier database.
The Corpus is still fetched once and shared, and per-User Criteria still govern everything else;
what changed is that "without regard for anyone's Criteria" now has a single, hard-coded exception.
