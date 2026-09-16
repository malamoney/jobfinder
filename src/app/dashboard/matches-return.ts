/**
 * How the matches list settles when the User steps back to it (#97, #99,
 * #142).
 *
 * "← Back to matches" is a history step, so the browser is expected to put the
 * list back at the offset the User left it at. Whether it does is up to the
 * browser: the list is unmounted while a Posting is open (no Cache Components,
 * so no `<Activity>` keeps it), on the step back it is rendered again from the
 * router's cache — or fetched, when that cache has been cleared — and the
 * browser holds its restore until the page is tall enough to take it. #99 then
 * fired `router.refresh()` (for the "Viewed" tag) on a 300ms timer, a bet that
 * the restore would already have landed. A refresh is a navigation to the same
 * URL, `history.replaceState` included, and one that lands before the
 * browser's restore leaves the User at the top (#142).
 *
 * So the list no longer waits on the browser. It remembers its own offset
 * while mounted, restores it itself when a traversal mounts it again, and
 * only then refreshes. There is no timer: the refresh follows the restore by
 * construction, however long the traversal took to render.
 *
 * A return is recognised by the `popstate` that caused it, not by the
 * router's `bfcacheId`: that id is restored from Next's data cache, which is
 * keyed by URL, so it is fresh on exactly the cache-miss traversal that
 * renders slowest — the case this exists for. Offsets are keyed by URL for the
 * same reason. Two history entries at the same URL therefore share one
 * offset, the later one's; the browser's own restore is per entry, but it is
 * also the thing that cannot be relied on here.
 *
 * Kept out of React so the sequence can be pinned without a browser
 * (`matches-return.test.ts`, and the hazard itself in
 * `matches-scroll-position.test.ts`). `RefreshMatches` supplies the window and
 * router pieces through a {@link ReturnEnv}.
 */

/** The browser and router, as the return sequence needs them. */
export type ReturnEnv = {
  /** Path and query of the list, as the browser reports it. */
  url: string;
  scrollY: () => number;
  scrollTo: (y: number) => void;
  /** `router.refresh()`: the in-place merge that keeps the scroll. */
  refresh: () => void;
  /** Reads and clears the flag the Posting page sets (`markMatchesStale`). */
  takeStale: () => boolean;
};

export type MatchesReturn = {
  /** A `popstate` landed on `url`: the next mount there is a return. */
  noteTraversal(url: string): void;
  /** The list at `url` is scrolled to `y`: the offset a return goes back to. */
  noteScroll(url: string, y: number): void;
  /**
   * The list has mounted, before paint. If a traversal brought it here, the
   * offset the User left at is put back.
   */
  restore(env: ReturnEnv): void;
  /**
   * The list has painted. Refreshes it in place if the Posting page flagged
   * it stale — only once {@link restore} has run for this mount.
   */
  settle(env: ReturnEnv): void;
};

export function createMatchesReturn(): MatchesReturn {
  const offsets = new Map<string, number>();
  let traversedTo: string | null = null;
  let restored = false;

  return {
    noteTraversal(url) {
      traversedTo = url;
    },
    noteScroll(url, y) {
      offsets.set(url, y);
    },
    restore(env) {
      const returning = traversedTo === env.url;
      traversedTo = null;
      if (returning) {
        const y = offsets.get(env.url);
        if (y !== undefined && env.scrollY() !== y) env.scrollTo(y);
      }
      restored = true;
    },
    settle(env) {
      if (!restored) return;
      restored = false;
      // Where the list sits now is where a return comes back to, until the
      // User scrolls. Read here, after paint, rather than in `restore`: on a
      // push the router's own scroll-to-top runs in a layout effect *above*
      // this island's, so before paint the window may still be wherever the
      // previous page left it.
      offsets.set(env.url, env.scrollY());
      if (env.takeStale()) env.refresh();
    },
  };
}
