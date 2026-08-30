# Job-Listing Data Sources — Field Survey

Researched 2026-08-24. Findings marked ✅ were verified by live HTTP calls at that date; anything
marked ⚠️ is secondary reporting. Re-verify before relying on specifics — this space moves.

## Bottom line

The big four job boards have **no read API at any price**. The viable spine is **ATS board APIs**
(Greenhouse, Lever, Ashby, Workable, Recruitee), which are open, unauthenticated, and return full
descriptions plus direct apply URLs. That spine plus USAJOBS, Himalayas, and The Muse realistically
reaches **10–20% of the US job market**, heavily biased toward venture-backed tech, salaried
white-collar, and remote engineering/design/PM roles.

## Tier 1 — build on these

| Source | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| **Greenhouse** | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | None | ✅ Full description in one call. 404 on bad slug |
| **Lever** | `https://api.lever.co/v0/postings/{slug}?mode=json` | None | ✅ `description`, `descriptionPlain`, `descriptionBody` |
| **Ashby** | `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | None | ✅ Full description **plus structured compensation** |
| **Workable** | `https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | None | ✅ Full description with `details=true` |
| **Recruitee** | `https://{slug}.recruitee.com/api/offers/` | None | ✅ Full description. Mostly EU companies |
| **USAJOBS** | `https://data.usajobs.gov/api/search` | Free key | ✅ No rate cap documented, 10K rows/query. US federal only |
| **Himalayas** | `https://himalayas.app/jobs/api` | None | ✅ 103,883 remote jobs, cursor pagination, actively maintained |
| **The Muse** | `https://www.themuse.com/api/public/jobs` | None (500/hr anon) | ✅ Full HTML in list response. **Hard cap at page 99** — slice by category × location × level |

### Tier 1 adapter notes — ✅ verified 2026-08-29

Checked live before writing the Lever, Ashby, Workable, and Recruitee adapters (#14). The first
column is the one the Corpus depends on: the Source Key is `(source, source_id)` and a Source
numbering its jobs only *within* a Board would have two companies silently overwriting each other
on every Fetch.

| Source | Id scope | Company name | Structured pay | Watch out for |
| --- | --- | --- | --- | --- |
| **Greenhouse** | Global (numeric, confirmed 2026-08-25) | `company_name` | No | `content` is HTML-escaped |
| **Lever** | Global (UUID) | **None published** | `salaryRange`, ~2% of postings | Bare array, no envelope; description split across `description` + `lists` + `additional` |
| **Ashby** | Global (UUID) | **None published** | `compensation.summaryComponents`, common | `compensation` is absent without `includeCompensation=true`; components include equity and bonus, only `compensationType: "Salary"` is pay; `secondaryLocations` carries most of where a job is open — 57 of 67 jobs on the sampled Board, median 4 and up to 19 |
| **Workable** | Global (`shortcode`, is the public URL) | Envelope `name` | No | **One entry per job per location** — the same `shortcode` arrives more than once |
| **Recruitee** | Global (numeric) — three Boards sampled, ids interleaved across 312,680–2,721,844 with no repetition | `company_name` | `salary`, EUR-heavy | Addressed by **subdomain**, so the Slug lands in the hostname; `requirements` is a document separate from `description`; dates are `2026-08-25 11:59:25 UTC`, not ISO 8601 |

Lever and Ashby publishing no company name is the finding with the widest blast radius: a Posting
must carry one — it is displayed, and it is a third of the Dedup Key — so those two adapters derive
it from the Slug (`companyFromSlug`).

Only USD pay is read from a structured field, for the same reason the prose extractor ignores
non-dollar figures: the floor a User states is in dollars and nothing converts currencies. That
excludes most of what Recruitee publishes.

Three of the five say more than one place per job, each in its own way — Workable by repeating the
job, Lever in `allLocations`, Ashby in `secondaryLocations` — and the Corpus holds one location
string per Posting. All of them are named, joined with ` / `. ⚠️ The Workable and Ashby samples were
one Board each; the Ashby one was entirely remote roles, so what a *commutable* multi-location job
looks like on that Source is unverified.

⚠️ Workable's public widget carries no `requirements` or `benefits` field — checked across three
accounts on 2026-08-29 — so `description` is the whole description. Those fields belong to the
authenticated v3 job API, which is not what this reads.

### Aggregator adapter notes — ✅ verified 2026-08-29 (USAJOBS, Himalayas)

Checked live before writing the USAJOBS and Himalayas adapters (#15). These two are not Boards — a
feed spanning many employers — so they diverge from the ATS spine in two ways, recorded in ADR
0007: absence from a Fetch is not evidence a role is gone (the feed is too large to pull whole), so
they expire by the close date the feed publishes; and the adapter pages a feed rather than making
one request, so it gets a longer fetch ceiling.

| Source | Reached by | Id | Pagination | Close date | Watch out for |
| --- | --- | --- | --- | --- | --- |
| **USAJOBS** | Keyword (`Slug`); `all` for everything | `MatchedObjectId`, global | `Page` 1..`SearchResult.UserArea.NumberOfPages`, 500/page | `ApplicationCloseDate` | Announcement lives two levels down under `MatchedObjectDescriptor`; pay figures are strings in `PositionRemuneration[].MinimumRange`; needs `Authorization-Key` + a `User-Agent` contact address, both from env — a Fetch with either missing **throws**, so #17 records a task failure rather than the Corpus silently losing every federal Posting |
| **Himalayas** | The feed (`Slug` names it only) | `guid` (the job's canonical URL), global | `nextCursor` → `?cursor=`, null on the last page, newest-first | `expiryDate` | Dates are epoch **seconds**, not ms; every role is remote and `locationRestrictions` narrows where; `nextCursor` paging also dedupes across pages as new jobs arrive at the top |

Each adapter caps its own request count — Himalayas pulls the ~2,000 newest, a USAJOBS keyword up to
5,000 — so a feed's size cannot spend a Worker's whole budget. Neither backfills the whole feed and
neither is meant to.

### Workday adapter notes — built #16

Workday is a Board (one company, absence expiry) but a deliberate extension rather than a member of
the spine: an undocumented internal endpoint, a **detail request per job**, and a tenant that cannot
be addressed from a Slug (ADR 0003).

| Reached by | Id | Pagination | Detail | Request budget |
| --- | --- | --- | --- | --- |
| A configured tenant in `@/sources/workday-tenants` — the Slug names it, and `{ shard, site, company, search }` is held by hand alongside | `{slug}:{externalPath}` — a requisition id is unique only *within* a tenant, so the Source Key is tenant-prefixed, done in the adapter rather than the schema | `POST .../wday/cxs/{slug}/{site}/jobs` with `{ appliedFacets, limit: 20, offset, searchText }`, until a page comes back short (`total` is only read for the budget check — it under-reports) | `GET .../wday/cxs/{slug}/{site}{externalPath}` per job → `jobPostingInfo.jobDescription` (HTML), `location`, `additionalLocations`, `remoteType`, `startDate`, `externalUrl` | `MAX_JOBS_PER_TENANT` (600), checked against both `total` and the list's own length. A tenant over it **throws** — #17 records it, and the search is narrowed or the ceiling raised deliberately |

- **`searchText` is fixed config, not a knob.** Each tenant carries a keyword (`engineer`) so the
  Corpus pulls only the slice ADR 0003 scopes it to — and because expiry reads absence from a
  successful Fetch as gone (ADR 0004), the slice has to be the same set night to night.
- **The shard is in the hostname, the site is in the path.** `{slug}.wd{N}.myworkdayjobs.com/wday/cxs/{slug}/{site}` —
  the adapter refuses a Slug or shard that is not a DNS label and a site that is not an opaque path
  segment, the same class of guard `boardSubdomain` gives Recruitee. `externalPath` from the list
  response is checked for `..`/scheme before it becomes a request path and a Source Key.
- **No harvesting path.** Discovery (#18) can turn up a `myworkdayjobs.com` host, but its shard,
  site, and search are a person's to add to the registry before a sweep touches it.
- ⚠️ Only NVIDIA (`wd5` / `NVIDIAExternalCareerSite`) is seeded and verified; add tenants as their
  shard and site are confirmed — a wrong one fails its seed probe and is added disabled.

The Muse was **not** built with these. Its pagination hard-caps at page 99 (`page` ≥ 100 → HTTP
400) while `page_count` in the body keeps counting past it, and slicing by `category` × `level` is
not fine enough — `Software Engineering` / `Senior Level` alone returned `page_count: 2017`,
`total: 40321` on 2026-08-29. Combined with a 500-requests/hour anonymous limit, a working adapter
needs a slice cursor persisted across Fetch Runs and a request budget. Tracked as its own issue.

### Slug discovery

No ATS offers a company directory. Harvest slugs from **Common Crawl CDX**:

```
https://index.commoncrawl.org/CC-MAIN-2026-34-index?url=job-boards.greenhouse.io%2F*&output=json
```

✅ Measured yield on 150 randomly sampled Greenhouse slugs: **126 (84%) still return jobs**, 21
dead/404, 3 empty. 6,749 total open reqs — mean 53.6/board, **median 13** (heavy tail). ~80% of
postings were US-located. Re-validate slugs quarterly; 16% had gone dead.

Prior art: `github.com/Feashliaa/job-board-aggregator` claims ~95,000 harvested slugs.

✅ Extended to Lever, Ashby, Workable, Recruitee (#46) — `pnpm discover --source <name>`, same
harvest → probe → curate loop. Slug position differs: first path segment for Lever/Ashby/Workable
(`jobs.lever.co/{slug}`, `jobs.ashbyhq.com/{slug}`, `apply.workable.com/{slug}`), subdomain for
Recruitee (`{slug}.recruitee.com`); Workable also has a legacy `{slug}.workable.com` form. Measured
on CC-MAIN-2026-34, 220 slugs sampled each: **Ashby 90% live** (2,611 harvested), **Workable 97%
live but only 57% advertising a role** (3,163 harvested), **Recruitee 20% live** (549 harvested,
EU-skewed). **Lever yielded nothing**: `jobs.lever.co` `Disallow`s CCBot in robots.txt so Common
Crawl has no Board pages under it, and the well-crawled `jobs.eu.lever.co` needs `api.eu.lever.co`,
which the adapter does not call — an EU-API widening is the follow-up.

## Tier 2 — breadth, with caveats

- **SmartRecruiters** — real volume, but **two calls per job** (list has no body) and returns
  `200 + totalFound: 0` for bad slugs, indistinguishable from a genuinely empty board.
- **Arbeitnow** — free, full descriptions, trivial. But **DE/UK-heavy**. Skip if US-only.
- **Adzuna** — instant key, good breadth, but **2,500 calls/month**, snippets only, redirector URLs,
  a mandatory 116×23px badge, and a ToS reading as a 14-day trial for anything non-personal.
- **Careerjet** — permissive in practice, but HTTP-only, snippet-only, and `jobviewtrack.com`
  redirects mean you cannot dedupe against the ATS corpus or link to the real posting.

## Tier 3 — pay only if the coverage gap hurts

- **SerpApi Google Jobs** — 250 free searches/mo, then $25/1K → $275/30K. Truncated descriptions.
  The cheapest legitimate window into the long tail.
- **JSearch** (RapidAPI) — 200/mo free, $25/10K. Resells scraped Indeed/LinkedIn/Glassdoor data;
  you inherit their exposure with a contract in between.
- **Coresignal** — $49/mo for 2,500 postings. Bad value below ~$1,500/mo tier.

## Do not bother

- **Remotive** — returns **18 jobs**. Now a paid product with a ~$5K/mo floor.
- **RemoteOK** — 100 jobs, no pagination, requires a dofollow backlink. Himalayas dominates it.
- **Findwork** — re-aggregates HN/YC/RemoteOK/WWR, all reachable directly.
- **Jooble** — **500 requests for the lifetime of the key**. A demo, not a source.
- **Reed** — good API, UK only.

## The big four — confirmed closed

- **LinkedIn** — Job Posting API is **write-only**, partner-gated. No read/search API at any price.
- **Indeed** — Publisher API retired ~2023. All current partner surfaces are employer-side.
- **Glassdoor** — public API closed ~2021–22. Owned by Recruit Holdings (Indeed's parent).
- **ZipRecruiter** — no REST search API, but publishes an **MCP server** at
  `https://api.ziprecruiter.com/mcp` (unauthenticated, `search_jobs`). ⚠️ Capped at ~5 results/call
  and returned 429 under test. Worth 20 minutes to re-verify; the cap may make it moot.

✅ Anti-bot tested from a datacenter IP with a real Chrome UA: Indeed, Glassdoor, and ZipRecruiter
HTML search all returned **403 + Cloudflare challenge**. LinkedIn's `/jobs-guest/` path is the one
open door.

⚠️ **Indeed's robots.txt says `Allow: /`** and explicitly permits paginated search result pages —
but its ToS separately prohibits "robots, spiders, or other automated means." robots.txt and ToS
conflict; **the ToS is the contract.**

## Legal picture

The enforcement pattern targets **commercial resellers at scale**, particularly those using fake
accounts or logged-in access. No hobby aggregator has been sued. But the theory that actually wins —
**breach of contract on accepted ToS** — has no revenue threshold.

- **hiQ v. LinkedIn** — won on CFAA, **lost on breach of contract**: $500K judgment, permanent
  injunction, corpus destruction. The CFAA win was pyrrhic.
- **Meta v. Bright Data** (N.D. Cal., Jan 2024) — Bright Data won; logged-**off** scraping of public
  pages didn't breach terms. The logged-out/logged-in line is now the operative distinction.
- **Ryanair v. Booking** (D. Del., Aug 2024) — jury found **CFAA liability** in the 3rd Circuit.
  Outlier, but the circuit split is real.
- **LinkedIn v. Nubela (Proxycurl)** — filed Jan 2025; **Proxycurl shut down July 4, 2025** with a
  permanent injunction and mandatory data deletion. ~$10M ARR, bootstrapped, chose not to fight.

## JobSpy — works, and is the riskiest thing here

`speedyapply/JobSpy`, 4,145 stars, MIT, ⚠️ **last commit 2026-02-18** (~6 months stale), 62 open
issues. The only credible scraping library left — `JobFunnel` was archived 2025-12-10.

✅ Live test, `python-jobspy==1.1.82`:

| Site | Result |
| --- | --- |
| Indeed | ✅ 10/10 rows with full descriptions |
| LinkedIn | ✅ 10/10 rows; descriptions need `linkedin_fetch_description=True` (+1 request/job) |
| Glassdoor | ❌ HTTP 400 — location endpoint changed |
| ZipRecruiter | ❌ 403 Cloudflare |
| Google | ❌ 0 rows — `async/callback` no longer parseable |

⚠️ **The critical finding:** JobSpy's Indeed path does not scrape HTML. It calls
`https://apis.indeed.com/graphql` with a **hardcoded API key lifted from Indeed's own client**
(`jobspy/indeed/constant.py:103`). That is why it passes the Cloudflare wall. It is therefore not
"reading public pages" — it is reusing credentials against a private API, the fact pattern most
likely to be characterized as circumventing an access control.

## Coverage reality check

⚠️ BLS JOLTS put US job openings at **7.4M in June 2026**. No one publishes active-listing totals
for Indeed or LinkedIn; circulating figures are inferences.

**Systematically covered:** venture-backed tech, mid-to-large tech-adjacent enterprise, salaried
white-collar, remote engineering/design/PM, federal government.

**Systematically missing — most of the labor market:**

- All hourly and shift work (retail, food service, warehouse, hospitality, delivery) — runs on
  Workstream, Fountain, Paycom, ADP, and direct Indeed/ZipRecruiter posting
- Healthcare staffing and travel nursing — the largest single US posting category
- Trucking, logistics, skilled trades, construction
- Local SMB — posts only to Indeed/Craigslist/Facebook
- Staffing agency and contract postings
- State and municipal government (NeoGov — separate ecosystem)
- **Anything on Workday, Taleo, iCIMS, SuccessFactors, Oracle** — most Fortune 500 non-tech hiring

### Workday — the biggest gray-zone option

Not in Tier 1 because it's an **undocumented internal endpoint**, not a published API — a materially
grayer position than Greenhouse et al. But it's the largest ATS by enterprise volume:

```
POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
     {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
GET  https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}
```

✅ Tested: NVIDIA `total: 2000`, Salesforce `total: 1526`; detail GET returned a 4,112-char
description. The `wd{N}` shard and site name vary per tenant, so discovery is fiddly.

⚠️ Market share often quoted as Workday ~32% / Greenhouse 18% / Lever 12% / Ashby 5% — these come
from SEO-marketing blogs with undisclosed methodology and skew tech/enterprise. Directional only.

## Google Jobs

- **No first-party read API.** Only ingestion-side interfaces (`JobPosting` JSON-LD + Indexing API).
- **Google Cloud Talent Solution v4** is a bring-your-own-corpus search engine — zero access to
  Google's index. Common misconception.
- The only working route is a **SERP proxy** (SerpApi, DataForSEO). Google removed the `chips` and
  `ltype` params, so filtering is weaker than it was.

## Re-verify before relying on

- ZipRecruiter MCP — could not get past `initialize` (429 from test IP)
- Findwork's 60 req/min — secondary source only
- Adzuna's country list — from marketing site, not docs
- ATS market-share percentages — SEO blogs, undisclosed methodology
- DataDome/PerimeterX vendor attribution — 403s confirmed, vendor stack secondhand
