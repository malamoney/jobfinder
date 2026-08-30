# Slug discovery by Common Crawl harvest and live probe

ADR 0003 records that no ATS Source publishes a directory of Boards, so the Slugs that name them
have to be found some other way, and `docs/research/job-sources.md` measures why sweeping the whole
harvested long tail is not that way — the yield is mostly companies in cities the user does not
live in, at a request cost the curated set exists to avoid.

**A Slug enters the curated set by being harvested from Common Crawl, probed against the live
Source API, and promoted by hand into a per-Source seed file.** The harvest and probe are
machinery; the promotion is a person reading a ranked report. All of it is run by hand
(`pnpm discover --source <name>`), nothing schedules it, and none of it writes to the Corpus.

## The pipeline

1. **Read a Slug out of a crawled URL** — `scripts/discovery/{source}-slugs.ts` exports a pure
   `slugFromUrl`. The Slug's position is the Source's, not ours: the first path segment for
   Greenhouse, Lever, Ashby, and Workable; the subdomain for Recruitee; and Workable also carries
   the legacy `{slug}.workable.com` form. Each reader lowercases, drops a `NOT_A_SLUG` denylist
   (`embed`, `robots.txt`, ATS-internal paths) and anything failing `SLUG_PATTERN`, and Recruitee
   additionally applies the adapter's own `isHostLabel` guard, since its Slug lands in a hostname.
2. **Harvest** — `scripts/discovery/common-crawl.ts` queries the Common Crawl CDX index for each of
   a Source's Board host patterns, reads every page, and runs `slugFromUrl` over each crawled URL.
   A Source is a `SlugSource` — its patterns and its reader — so the plumbing is written once.
3. **Probe** — `discover-boards.ts` probes every harvested Slug not already curated against the
   live Source API (`probeBoard`), ranking by the number of open roles with a sample of the titles.
   `--limit N` probes a random N instead, for a fast pass. Probing runs 8-wide and takes minutes;
   it is a hand-run script, not the nightly sweep, so the cost buys a complete ranked list rather
   than one shaped by which Slugs happened to be sampled.
4. **Curate** — a person pastes the Slugs worth sweeping into `scripts/data/{source}-boards.ts`.
   This is the one non-mechanical step. Discovery delivers a machine-checked list, not a hand-tuned
   final one.
5. **Seed** — `pnpm seed:boards` re-probes every listed Slug and upserts it into `boards`
   (`seedBoards`), added *disabled* if it cannot be fetched.

## Invariants

- **Discovery never writes to the Corpus.** A probe reads a Board and reports on it; a candidate
  nobody has promoted has no `boards` row, and the Corpus is shared by every User. This is
  structural — `probeBoard` calls `readBoard`, never `reconcileBoard`.
- **Candidate order is shuffled, never the head of the harvest.** The CDX index answers in SURT
  (roughly alphabetical) order. A `--limit` run draws its N uniformly at random, and even a full
  probe-all run is shuffled first, so a run cut short partway has still covered a representative
  spread rather than every company beginning with "a". A run that could not read some index pages
  says so loudly, because a lost page is a lost stretch of the alphabet, not a thinner sample.
- **A promoted Slug is probed before it is written, and a dead one is seeded disabled, not
  omitted.** Leaving a dead Slug out of the seed file only lets the next discovery run rediscover
  it and offer it up as though it were new; disabled, the decision stays made. `pnpm boards:status`
  surfaces Boards that have since died.

## Consequences

- The curated set decays — ADR 0003 records roughly one in six harvested Slugs dead within a
  sampling window — so it has to be re-probed periodically, not just grown.
- Coverage is bounded by what Common Crawl has seen. A Board host that blocks CCBot in robots.txt
  (`jobs.lever.co`) yields nothing at all, and a regional host that is crawled but is served by an
  API the adapter does not call (`jobs.eu.lever.co` → `api.eu.lever.co`) yields only dead probes.
  This is why the Lever seed shipped empty; #48 tracks the fix.
- Aggregators and Workday have no harvesting path, by design. An Aggregator's Slug is a slice of a
  feed rather than a company (ADR 0007), and a Workday Tenant cannot be addressed from its Slug
  alone (ADR 0003). Both are hand-maintained short lists.
