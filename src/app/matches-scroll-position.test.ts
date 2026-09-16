import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createMatchesReturn,
  type ReturnEnv,
} from "./dashboard/matches-return";

/**
 * Guardrails for the matches-list scroll position (#97, regression #99).
 *
 * When a User scrolls the matches list, opens a Posting, and comes back, they
 * land where they left off. That works only because the list is still in the
 * router's back/forward cache when they step back:
 *
 *  - `BackToMatches` navigates with `router.back()` (a history step, which the
 *    browser restores scroll for) rather than a forward `router.push`/`<Link>`
 *    to `/dashboard` (which lands at the top);
 *  - nothing on the Posting page invalidates `/dashboard`. #98 added
 *    `revalidatePath("/dashboard")` to `markViewedAction` to freshen a card's
 *    "Viewed" tag — that evicted the cache entry and dropped the scroll
 *    offset (#99). The tag now updates through `RefreshMatches`, which calls
 *    `router.refresh()` (an in-place merge that keeps the scroll) once the
 *    User is back;
 *  - that refresh comes *after* the scroll is back, not on a timer that
 *    guesses when the browser will have restored it (#142). The island puts
 *    the offset back itself before paint and refreshes after; a refresh that
 *    lands first is a `replaceState` navigation that abandons the browser's
 *    pending restore.
 *
 * Mostly these read the source, so a change from a distance that reintroduces the
 * broken shape fails here rather than in someone's hands. The mechanism is a
 * browser interaction with no home in the operations seam; this is the cheap
 * always-on check that stands in for an end-to-end one.
 */

const REPO = fileURLToPath(new URL("../../", import.meta.url));

function source(pathFromRepo: string): string {
  try {
    return readFileSync(`${REPO}${pathFromRepo}`, "utf8");
  } catch {
    throw new Error(
      `${pathFromRepo} is gone or moved. It carries part of the matches-list ` +
        `scroll-restoration contract (#97/#99) — update this test to point at ` +
        `its new home, and check the contract still holds there.`,
    );
  }
}

// Drops line and block comments so prose that names the forbidden shapes (the
// doc comments do, on purpose) is not matched by the assertions below.
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the matches list keeps its scroll position on return (#97, #99)", () => {
  it("no action fired from the Posting page invalidates the matches route", () => {
    // Every action in this file runs on the Posting page, right before the
    // User steps back to the matches list. `revalidatePath`/`revalidateTag`
    // on `/dashboard` (or the root) evicts that list from the back/forward
    // cache, so the step back re-fetches it and the scroll offset is lost.
    // Freshen a card in place with `RefreshMatches` instead.
    const actions = code(source("src/app/postings/[id]/actions.ts"));

    expect(actions).not.toMatch(
      /revalidate(Path|Tag)\s*\(\s*["'`](\/dashboard\b|\/)["'`]/,
    );
    // Nothing here should reach for `next/cache` at all today; if that changes
    // for a route that is not the matches list, narrow the check above.
    expect(actions).not.toMatch(/from\s+["']next\/cache["']/);
  });

  it('"Back to matches" steps back through history, not forward to /dashboard', () => {
    const backLink = code(source("src/app/postings/[id]/back-to-matches.tsx"));

    expect(backLink).toMatch(/router\.back\s*\(\s*\)/);
    expect(backLink).not.toMatch(/router\.(push|replace)\s*\(/);
  });

  it('the "Viewed" tag updates through an in-place refresh, not a revalidate', () => {
    const markViewed = code(source("src/app/postings/[id]/mark-viewed.tsx"));
    const refreshMatches = code(source("src/app/dashboard/refresh-matches.tsx"));
    const dashboard = code(source("src/app/dashboard/page.tsx"));

    // The Posting page flags the list stale rather than revalidating it,
    expect(markViewed).toMatch(/markMatchesStale\s*\(/);
    // the dashboard mounts the component that acts on that flag,
    expect(dashboard).toMatch(/<RefreshMatches\b/);
    // and that component refreshes in place — the one refresh that does not
    // move the scroll.
    expect(refreshMatches).toMatch(/router\.refresh\s*\(\s*\)/);
  });

  it("the refresh waits on the scroll being put back, not on a clock (#142)", () => {
    // #99 fired the refresh 300ms after mount — a guess at when the browser's
    // deferred scroll restore had landed. The island now restores the offset
    // itself before paint and refreshes after (`matches-return.ts`); this
    // keeps a timer from standing in for that again, and the case below plays
    // the hazard out.
    const refreshMatches = code(source("src/app/dashboard/refresh-matches.tsx"));

    expect(refreshMatches).not.toMatch(/setTimeout|setInterval/);
    // The restore runs before paint, and the step back is noted from
    // `popstate` — the island is not mounted when it happens.
    expect(refreshMatches).toMatch(/useLayoutEffect/);
    expect(refreshMatches).toMatch(/addEventListener\s*\(\s*["']popstate["']/);
  });

  it("a slow step back still lands where the User was, refresh and all (#142)", () => {
    // The hazard: the browser holds its restore of a same-document history
    // step until the page is tall enough to take it, and a `router.refresh()`
    // — a `replaceState` navigation to the same URL — that lands first
    // abandons it. #99's 300ms timer lost that race whenever the step back
    // took longer to render than that (cold cache, a large matched set), and
    // the User came back to the top.
    //
    // So this browser is slow: the User left the list at 1400, the window is
    // at the top when the list mounts, the browser's restore is a full second
    // out, and a refresh that beats it cancels it. Against the timer this
    // failed — the refresh fired at 300ms, cancelled the restore, and the
    // window stayed at 0. Now the offset is put back before the refresh is
    // even asked for, so the browser's late restore has nothing left to do.
    vi.useFakeTimers();
    try {
      let scrollY = 0;
      const browserRestore = setTimeout(() => {
        scrollY = 1400;
      }, 1000);
      const seenByRefresh: number[] = [];
      const env: ReturnEnv = {
        url: "/dashboard",
        scrollY: () => scrollY,
        scrollTo: (y) => {
          scrollY = y;
        },
        refresh: () => {
          seenByRefresh.push(scrollY);
          clearTimeout(browserRestore);
        },
        takeStale: () => true,
      };

      const matches = createMatchesReturn();
      matches.noteScroll("/dashboard", 1400);
      matches.noteTraversal("/dashboard");
      matches.restore(env); // the island's layout effect
      matches.settle(env); // its passive effect

      expect(seenByRefresh).toEqual([1400]);
      vi.advanceTimersByTime(1000);
      expect(scrollY).toBe(1400);
    } finally {
      vi.useRealTimers();
    }
  });
});
