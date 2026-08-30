/**
 * The curated set of Recruitee Boards a nightly sweep covers.
 *
 * Curation over harvesting is the cost decision `greenhouse-boards.ts`
 * records in full: no Source publishes a directory of Boards (ADR 0003), so
 * Slugs are harvested from Common Crawl and revalidated, and
 * `docs/research/job-sources.md` weighs what sweeping the long tail would
 * cost against a yield that is mostly companies in cities the user does not
 * live in. This list is the alternative.
 *
 * Every Slug here was harvested from Common Crawl and then probed against the
 * live Recruitee API, so it is a list of Boards that answered rather than a
 * list of guesses. The run behind it: every `{slug}.recruitee.com` swept from
 * CC-MAIN-2026-34, 549 distinct Slugs found, 220 sampled uniformly at random,
 * 44 live — a far lower hit rate than the other Sources, and what survives is
 * European (see `docs/research/job-sources.md`), so a curator leaning this
 * set toward the user's cities has little to work with yet. Boards
 * advertising fewer than three Postings were left out.
 *
 * Grown by hand. Re-run `pnpm discover --source recruitee` for fresh
 * candidates: it probes them and prints what each is advertising, so the set
 * can be leant toward the roles being searched for. Promoting a Board means
 * pasting its Slug in here and re-running `pnpm seed:boards`. A Board that
 * later dies is disabled rather than removed — deleting it would only let the
 * next discovery run offer it up again as though it were new. `pnpm
 * boards:status` shows which have died.
 */
export const RECRUITEE_BOARDS: readonly string[] = [
  "academyofdigitalindustries",
  "aerodesignworksgmbh",
  "allyourbi",
  "aquablu",
  "aveniq",
  "baeckermueller",
  "cainwattersassociates",
  "cb",
  "congreshotelliege",
  "ctscompositetechnologiesystemegmbh",
  "dyflexis",
  "easyconnectundkulturplanner",
  "fastned",
  "gainpro",
  "getontop",
  "gigastorage",
  "hotelmelle",
  "hygraph",
  "innovamarketinsights",
  "loxam",
  "mcguiremarketinggmbh",
  "medialo",
  "miebachconsulting",
  "mittwaldcmservicegmbhcokg",
  "natuvion",
  "ottawasafetycouncil",
  "polytek",
  "spring",
  "tdfitnessperformance",
  "trustflight",
  "upslide",
  "vandervalkhotelvenlo",
  "vebegofacilityservices3",
  "vijverberg",
  "wilcoxflegel",
];
