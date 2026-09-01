# Company icons from Logo.dev, looked up by name

Each Dashboard card shows a small logo for the company. The logo is fetched from **Logo.dev**'s logo
CDN, keyed by the **company name** (`https://img.logo.dev/name/{company}`), and rendered by
`CompanyIcon` straight from that CDN with a `next/image` custom loader. A company Logo.dev cannot
place falls back to a **monogram** — the company's first initial on a neutral disc.

Nothing about this touches the Corpus: there is no icon table, no resolver, and no sweep step. The
CDN is the cache.

This supersedes the implementation note in the epic (#2), which called for *"[icons] derived from the
apply URL's domain favicon and cached. No third-party logo vendor."*

## Why not the apply URL's favicon

The apply URL a Posting carries is the applicant-tracking system's, not the company's:
`job-boards.greenhouse.io/acme/…`, `jobs.lever.co/acme/…`, `jobs.ashbyhq.com/acme/…`,
`apply.workable.com/j/…`. Its registrable domain is `greenhouse.io` / `lever.co` / `ashbyhq.com`,
and the favicon there is the ATS's mark — so every Greenhouse company would show the Greenhouse
logo. Only Recruitee (and some Workday tenants) publish an apply URL on a company-owned domain.

The Corpus stores no company website anywhere else either. The company **name** is the only handle
we have, and Logo.dev looks up by name.

## Why a vendor after all

The epic ruled out a logo vendor to avoid a dependency and a provisioned secret. But the favicon
route it preferred does not actually produce company icons here, and a hand-rolled favicon scraper
(fetch the page, parse `<link rel=icon>`, fall back to `/favicon.ico`, cap the download, cache the
bytes or a Blob URL) is a meaningful amount of code and a nightly bounded pass — all to resolve, at
best, a company domain we would still have to guess.

Logo.dev collapses that to an `<img>`:

- The token (`NEXT_PUBLIC_LOGODEV_TOKEN`) is **publishable** — it is meant for the browser — so it
  is not a CI secret in the sense `CRON_SECRET` is; it ships in the client bundle.
- The CDN is already sized, cached, and CORS-open. There is nothing to store and nothing to warm.
- `strategy=match` ranks by exact match rather than Logo.dev's default popular-prefix typeahead,
  which otherwise resolves an unknown company onto a well-known one. `fallback=404` then makes it
  return a 404 for a name it still cannot place, so `CompanyIcon`'s `onError` shows the app's own
  monogram (a neutral disc) rather than a generated one.

## Rendered straight from the CDN, not through the optimizer

`CompanyIcon` passes `next/image` a custom `loader`, so the browser loads the logo directly from
`img.logo.dev` instead of through Vercel's image optimization proxy. The CDN already serves a small,
correctly-sized, cacheable PNG, and routing every card's logo through the Vercel proxy would add a
per-image cost this project is otherwise trimming (cf. #52, #61 on Neon). `next.config.ts` still
lists `img.logo.dev` under `images.remotePatterns` as a backstop if the loader is ever removed.

`next/image` is kept (rather than a bare `<img>`) for its fixed `width`/`height`: the 36 px box is
reserved before anything loads, so a slow or failed logo never shifts the card.

## Consequences

- **Accuracy is name-based.** Logo.dev resolves most real company names well; `strategy=match`
  keeps it from fuzzing an unknown name onto a famous one, and a genuine miss 404s to the monogram.
  A multi-word name can still catch a generic icon on a shared word ("… Labs"), and a company that
  opted out of Logo.dev (Stripe) gets a placeholder. Both are rare and low-stakes on a triage card.
  If it proves annoying, the fix is to capture a company domain during Extraction and look up by
  domain — a strictly better key — not to change vendors.
- **A Logo.dev outage shows monograms.** No worse than a page of cache misses; the Dashboard still
  renders.
- **Attribution.** Logo.dev's free tier asks for a link back where its logos appear. The Dashboard
  footer carries one. A paid plan removes the requirement.
- **The icon is not on the Posting detail page yet** — same as the issue scoped it. `CompanyIcon`
  is reusable there whenever that is wanted.
- **What #62 specced and this does not build:** a `company_icons` table, a favicon resolver with
  MSW tests through the `@/operations` seam, a bounded nightly resolution pass, Vercel Blob. The
  vendor makes all of it unnecessary. The logic that remains — the CDN URL and the monogram letter
  — is pure and tested in `format.test.ts`.
