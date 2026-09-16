import { describe, expect, it, vi } from "vitest";
import { createMatchesReturn, type ReturnEnv } from "./matches-return";

/**
 * The return sequence, step by step (#142). The timing hazard it exists for
 * is played out in `matches-scroll-position.test.ts`, with the rest of the
 * scroll-position contract; these pin what each step does and does not do.
 *
 * Each test plays one browser: `scrollY` is where the window is, `scrollTo`
 * moves it, `refresh` stands in for `router.refresh()`, and `takeStale` for
 * the flag the Posting page leaves. A traversal is what a `popstate` reports;
 * the two arrival steps are what the island's layout and passive effects call.
 */

const LIST_URL = "/dashboard";

function browser({
  at = 0,
  stale = true,
}: { at?: number; stale?: boolean } = {}) {
  let y = at;
  let flagged = stale;
  const env: ReturnEnv = {
    url: LIST_URL,
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
  return env;
}

describe("a return to the matches list", () => {
  it("puts the offset back before the refresh", () => {
    const matches = createMatchesReturn();
    matches.noteScroll(LIST_URL, 1400);
    matches.noteTraversal(LIST_URL);
    const b = browser({ at: 0 });

    matches.restore(b);
    expect(b.scrollTo).toHaveBeenCalledWith(1400);
    expect(b.refresh).not.toHaveBeenCalled();

    matches.settle(b);
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not scroll when the browser already put the offset back", () => {
    const matches = createMatchesReturn();
    matches.noteScroll(LIST_URL, 1400);
    matches.noteTraversal(LIST_URL);
    const b = browser({ at: 1400 });
    matches.restore(b);
    expect(b.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the scroll to the browser when nothing is remembered", () => {
    // After a full reload the memory is empty (a cold tab is the same shape);
    // there is nothing to put back, and the refresh still lands.
    const matches = createMatchesReturn();
    matches.noteTraversal(LIST_URL);
    const b = browser({ at: 0 });
    matches.restore(b);
    matches.settle(b);
    expect(b.scrollTo).not.toHaveBeenCalled();
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("a fresh navigation to the matches list", () => {
  it("lands where the router put it, and that is the offset a later return goes back to", () => {
    // An earlier visit to the same URL was left at 1400. The User then reaches
    // the list through the nav (a push, not a step back): the router lands it
    // at the top, and nothing may drag it to 1400. Leaving from there without
    // scrolling and stepping back must come back to the top, too.
    const matches = createMatchesReturn();
    matches.noteScroll(LIST_URL, 1400);

    const fresh = browser({ at: 0, stale: false });
    matches.restore(fresh);
    matches.settle(fresh);
    expect(fresh.scrollTo).not.toHaveBeenCalled();

    const back = browser({ at: 0, stale: true });
    matches.noteTraversal(LIST_URL);
    matches.restore(back);
    matches.settle(back);
    expect(back.scrollTo).not.toHaveBeenCalled();
    expect(back.refresh).toHaveBeenCalledTimes(1);
  });

  it("is not a return just because some other page was reached by history", () => {
    // Forward to a Posting by history, then to the list through the nav: the
    // last traversal was not to the list, so this mount is a fresh one.
    const matches = createMatchesReturn();
    matches.noteScroll(LIST_URL, 1400);
    matches.noteTraversal("/postings/abc");
    const b = browser({ at: 0 });
    matches.restore(b);
    expect(b.scrollTo).not.toHaveBeenCalled();
  });
});

describe("the refresh", () => {
  it("does not fire until the offset has been put back", () => {
    // `settle` without `restore` is a mis-wired island; the refresh must wait
    // for the restore rather than race it, and must not eat the stale flag.
    const matches = createMatchesReturn();
    const b = browser({ at: 0 });
    matches.settle(b);
    expect(b.refresh).not.toHaveBeenCalled();
    expect(b.takeStale).not.toHaveBeenCalled();

    matches.restore(b);
    matches.settle(b);
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });

  it("fires once when React mounts the island twice (dev double-invoke)", () => {
    const matches = createMatchesReturn();
    matches.noteScroll(LIST_URL, 900);
    matches.noteTraversal(LIST_URL);
    const b = browser({ at: 0 });

    matches.restore(b);
    matches.settle(b);
    matches.restore(b);
    matches.settle(b);

    expect(b.scrollTo).toHaveBeenCalledTimes(1);
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the Posting page left no stale flag", () => {
    const matches = createMatchesReturn();
    matches.noteTraversal(LIST_URL);
    const b = browser({ at: 0, stale: false });
    matches.restore(b);
    matches.settle(b);
    expect(b.refresh).not.toHaveBeenCalled();
  });
});
