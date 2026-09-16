import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMatchesReturn, type ReturnEnv } from "./matches-return";

/**
 * How the matches list settles when the User steps back to it (#97, #99,
 * #142).
 *
 * Each test plays one browser: `scrollY` is where the window is, `scrollTo`
 * moves it, `refresh` stands in for `router.refresh()`, and `takeStale` for the
 * flag the Posting page leaves. A traversal is what a `popstate` reports; the
 * two arrival steps are what the component's layout and passive effects call.
 */

const URL = "/dashboard";

function browser({
  at = 0,
  stale = true,
}: { at?: number; stale?: boolean } = {}) {
  let y = at;
  let flagged = stale;
  const env: ReturnEnv = {
    url: URL,
    scrollY: () => y,
    scrollTo: vi.fn((to: number) => {
      y = to;
    }),
    refresh: vi.fn(),
    takeStale: vi.fn(() => {
      const was = flagged;
      flagged = false;
      return was;
    }),
  };
  return {
    env,
    /** The browser's own restore, if and when it comes. */
    restoreTo(to: number) {
      y = to;
    },
    get scrollY() {
      return y;
    },
  };
}

describe("returning to the matches list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the offset back before the refresh, however late the browser's own restore comes", () => {
    // The User had scrolled to 1400 and opened a Posting. Stepping back, the
    // list mounts while the window is still at the top; the browser's deferred
    // restore is a full second away — far past the 300ms the old timer bet on,
    // which is when #142's refresh landed with the list still at the top.
    const b = browser({ at: 0 });
    const seenByRefresh: number[] = [];
    (b.env.refresh as ReturnType<typeof vi.fn>).mockImplementation(() => {
      seenByRefresh.push(b.scrollY);
    });
    setTimeout(() => b.restoreTo(1400), 1000);

    const matches = createMatchesReturn();
    matches.noteScroll(URL, 1400);
    matches.noteTraversal(URL);

    matches.restore(b.env);
    matches.settle(b.env);

    expect(b.env.scrollTo).toHaveBeenCalledWith(1400);
    expect(seenByRefresh).toEqual([1400]);

    vi.advanceTimersByTime(1000);
    expect(b.scrollY).toBe(1400);
  });
});

describe("a fresh navigation to the matches list", () => {
  it("lands where the router put it, and that is the offset a later return goes back to", () => {
    // An earlier visit to the same URL was left at 1400. The User then reaches
    // the list through the nav (a push, not a step back): the router lands it
    // at the top, and nothing may drag it to 1400. Leaving from there without
    // scrolling and stepping back must come back to the top, too.
    const matches = createMatchesReturn();
    matches.noteScroll(URL, 1400);

    const fresh = browser({ at: 0, stale: false });
    matches.restore(fresh.env);
    matches.settle(fresh.env);
    expect(fresh.env.scrollTo).not.toHaveBeenCalled();

    const back = browser({ at: 0, stale: true });
    matches.noteTraversal(URL);
    matches.restore(back.env);
    matches.settle(back.env);
    expect(back.env.scrollTo).not.toHaveBeenCalled();
    expect(back.env.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the refresh", () => {
  it("does not fire until the offset has been put back", () => {
    // `settle` without `restore` is a mis-wired island; the refresh must wait
    // for the restore rather than race it, and must not eat the stale flag.
    const matches = createMatchesReturn();
    const b = browser({ at: 0 });
    matches.settle(b.env);
    expect(b.env.refresh).not.toHaveBeenCalled();
    expect(b.env.takeStale).not.toHaveBeenCalled();

    matches.restore(b.env);
    matches.settle(b.env);
    expect(b.env.refresh).toHaveBeenCalledTimes(1);
  });

  it("fires once when React mounts the island twice (dev double-invoke)", () => {
    const matches = createMatchesReturn();
    matches.noteScroll(URL, 900);
    matches.noteTraversal(URL);
    const b = browser({ at: 0 });

    matches.restore(b.env);
    matches.settle(b.env);
    matches.restore(b.env);
    matches.settle(b.env);

    expect(b.env.scrollTo).toHaveBeenCalledTimes(1);
    expect(b.env.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the Posting page left no stale flag", () => {
    const matches = createMatchesReturn();
    matches.noteTraversal(URL);
    const b = browser({ at: 0, stale: false });
    matches.restore(b.env);
    matches.settle(b.env);
    expect(b.env.refresh).not.toHaveBeenCalled();
  });
});

describe("what counts as a return", () => {
  it("a traversal that landed on some other page does not move this list", () => {
    // Forward to a Posting by history, then to the list through the nav: the
    // last traversal was not to the list, so this mount is a fresh one.
    const matches = createMatchesReturn();
    matches.noteScroll(URL, 1400);
    matches.noteTraversal("/postings/abc");
    const b = browser({ at: 0 });
    matches.restore(b.env);
    expect(b.env.scrollTo).not.toHaveBeenCalled();
  });

  it("a return with nothing remembered leaves the scroll to the browser", () => {
    // After a full reload the memory is empty (a cold tab is the same shape);
    // there is nothing to put back, and the refresh still lands.
    const matches = createMatchesReturn();
    matches.noteTraversal(URL);
    const b = browser({ at: 0 });
    matches.restore(b.env);
    matches.settle(b.env);
    expect(b.env.scrollTo).not.toHaveBeenCalled();
    expect(b.env.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not scroll when the browser already put the offset back", () => {
    const matches = createMatchesReturn();
    matches.noteScroll(URL, 1400);
    matches.noteTraversal(URL);
    const b = browser({ at: 1400 });
    matches.restore(b.env);
    expect(b.env.scrollTo).not.toHaveBeenCalled();
  });
});
