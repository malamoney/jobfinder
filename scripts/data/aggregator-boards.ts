import type { BoardAddress } from "@/operations";

/**
 * The aggregator feeds a nightly sweep covers (#15).
 *
 * Unlike the ATS Boards, these are not one company each — they are whole feeds
 * spanning many employers (ADR 0003, `docs/research/job-sources.md`). The Slug
 * is not a company:
 *
 * - **USAJOBS** is reached per keyword. A bare query is the entire federal
 *   corpus, so the set is a short list of the roles being searched for; a Slug
 *   of `all` would ask for everything. USAJOBS also needs `USAJOBS_API_KEY` and
 *   `USAJOBS_USER_AGENT` in the environment — without them the seed probe fails
 *   and the Board is added disabled, to be enabled once the key is set.
 * - **Himalayas** is a single remote-jobs feed with nothing to slice, so the
 *   Slug just names it.
 *
 * Grown by hand, like the ATS set. Add a USAJOBS keyword by adding a line.
 */
export const AGGREGATOR_BOARDS: BoardAddress[] = [
  { source: "himalayas", slug: "remote" },
  { source: "usajobs", slug: "software-engineer" },
  { source: "usajobs", slug: "data-scientist" },
  { source: "usajobs", slug: "product-manager" },
  { source: "usajobs", slug: "program-analyst" },
];
