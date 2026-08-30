# ATS board APIs as the ingestion spine

Postings come from applicant-tracking Boards — Greenhouse, Lever, Ashby, Workable, Recruitee —
plus USAJOBS, Himalayas, and The Muse, with Workday as a deliberate extension. They do not come
from Indeed, LinkedIn, Glassdoor, or ZipRecruiter, because as of August 2026 none of those offers
a read API for job search at any price, and all of them serve 403 challenges to automated requests.
The ATS endpoints are published, unauthenticated, return full descriptions and direct apply URLs,
and impose no attribution requirements. See `docs/research/job-sources.md` for the survey this rests
on.

Workday is included despite being an *undocumented internal* endpoint rather than a published API,
because it hosts much of the Fortune 500 hiring that Tier 1 structurally misses. The line was drawn
just past it: JobSpy's Indeed adapter was rejected even though it works, because it authenticates to
a private GraphQL API using a key extracted from Indeed's own client, which is credential reuse
rather than reading public data.

Workday's request cost is what keeps it an extension rather than a peer. It needs a detail request
per job, so one tenant costs what hundreds of Greenhouse Boards cost. It is therefore fetched as the
slice of itself that matches a keyword, from a hand-maintained tenant list with no harvesting path
(`@/sources/workday-tenants`), under a per-tenant job budget that fails the Fetch rather than
growing unnoticed (`MAX_JOBS_PER_TENANT`). See `docs/research/job-sources.md`.

## Consequences

- The Corpus covers an estimated 10–20% of the US job market, skewed hard toward venture-backed
  tech, salaried white-collar, and remote engineering/design/PM roles. This matches the intended
  user and is not a defect.
- Systematically absent: hourly and shift work, healthcare and travel nursing, trades, logistics,
  local SMB, state and municipal government, and employers on Taleo, iCIMS, or SuccessFactors.
- No Source offers a directory of Boards, so Slugs must be harvested (Common Crawl CDX works) and
  re-validated periodically — roughly 16% of harvested Slugs were dead within a sampling window.
