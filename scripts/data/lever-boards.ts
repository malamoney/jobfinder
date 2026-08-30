/**
 * The curated set of Lever Boards a nightly sweep covers.
 *
 * Empty for now, and not for lack of trying. `pnpm discover --source lever`
 * harvests `jobs.lever.co`, and in CC-MAIN-2026-34 that host has no Board
 * pages at all — its robots.txt `Disallow`s CCBot from everything but
 * `/robots.txt`, so Common Crawl has never seen a Lever Board there. The other
 * Lever board host, `jobs.eu.lever.co`, is well crawled, but a Board on it is
 * served by `api.eu.lever.co`, which `fetchLeverBoard` does not call — every
 * one of those Slugs failed its probe. Widening the adapter to the EU API, and
 * the harvester to the EU host with it, is the follow-up that fills this list.
 *
 * When there are Slugs to add: each is harvested from Common Crawl and probed
 * against the live Lever API before it goes in, and a Board that later dies is
 * disabled rather than removed — the same rules `greenhouse-boards.ts` spells
 * out. `pnpm discover --source lever` prints a paste-ready list; `pnpm
 * seed:boards` writes it.
 */
export const LEVER_BOARDS: readonly string[] = [];
