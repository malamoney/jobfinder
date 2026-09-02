import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
 *    User is back.
 *
 * These read the source, so a change from a distance that reintroduces the
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
});
