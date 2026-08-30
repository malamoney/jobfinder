/**
 * The curated set of Workable Boards a nightly sweep covers.
 *
 * Curation over harvesting is the cost decision `greenhouse-boards.ts`
 * records in full: no Source publishes a directory of Boards (ADR 0003), so
 * Slugs are harvested from Common Crawl and revalidated, and
 * `docs/research/job-sources.md` weighs what sweeping the long tail would
 * cost against a yield that is mostly companies in cities the user does not
 * live in. This list is the alternative.
 *
 * Every Slug here was harvested from Common Crawl and then probed against the
 * live Workable API, so it is a list of Boards that answered rather than a
 * list of guesses. The run behind it: `apply.workable.com` and every
 * `{slug}.workable.com` swept from CC-MAIN-2026-34, 3,163 distinct Slugs
 * found, 220 sampled uniformly at random, 214 live but only 125 advertising a
 * role — Workable's long tail is thick with dormant Boards. Boards
 * advertising fewer than three Postings were left out.
 *
 * Grown by hand. Re-run `pnpm discover --source workable` for fresh
 * candidates: it probes them and prints what each is advertising, so the set
 * can be leant toward the roles being searched for. Promoting a Board means
 * pasting its Slug in here and re-running `pnpm seed:boards`. A Board that
 * later dies is disabled rather than removed — deleting it would only let the
 * next discovery run offer it up again as though it were new. `pnpm
 * boards:status` shows which have died.
 */
export const WORKABLE_BOARDS: readonly string[] = [
  "1global",
  "agad-technology",
  "aha",
  "apivita",
  "arch-aerial-llc",
  "assurity-trusted-solutions",
  "ayana",
  "banksvaluation",
  "bartlett-and-co-dot-llc",
  "bassett-healthcare-network",
  "biomapas",
  "bmat",
  "booknook-inc",
  "boostdraft",
  "burq",
  "cadillacf1team",
  "cara-care",
  "celestino",
  "circlelink-health",
  "clarkston-consulting",
  "coldquanta",
  "conflux",
  "control-risks-6",
  "curbwaste",
  "davy",
  "debiopharm",
  "deboers-auto",
  "degy",
  "dragonfly-cares",
  "edge-electric",
  "emw",
  "envisiones",
  "ferguson-roofingand-exteriors",
  "finartix",
  "foundervine",
  "freelance-latin-america",
  "futuresight",
  "futurpreneur",
  "g-20-advisors-ag",
  "harlem-childrens-zone",
  "healingus-centers",
  "hilobyaktiia",
  "hint",
  "hoffmann-brothers",
  "hudabeauty",
  "iita",
  "inautalent",
  "international-water-management-institute",
  "isupport-worldwide",
  "itselectric",
  "jasmax-1",
  "kaufmanrossin",
  "keylane",
  "kueckerpulseintegration",
  "moonbug-entertainment",
  "morrow-health",
  "mythwright",
  "nav-real-estate",
  "navarro-inc",
  "newenergynexus",
  "nrgco",
  "optasia",
  "paleovalley-wildpastures",
  "peak-made",
  "pearltalent",
  "pixelogicmedia",
  "povio",
  "proarch-3",
  "quandela",
  "quickrelease",
  "rcbpi",
  "re-act-marketing-ltd",
  "real-dev-inc",
  "remote-talent-latam",
  "saleshub",
  "sand-cherry-associates-1",
  "scalesource-1",
  "school-of-coding",
  "smappee",
  "smartfinancial",
  "studyportals",
  "supportyourapp",
  "surglobal",
  "surrey-cricket-club",
  "teicservices",
  "the-jean-tweed-centre",
  "uniteamerica",
  "valatam",
  "valneva",
  "verneek",
  "voyago",
  "westfalia-fruit",
  "whizz",
  "winning-assistants",
  "word-is-bond",
  "world-central-kitchen",
  "woundlocalcareers",
  "zaintech",
  "zirtual-llc",
];
