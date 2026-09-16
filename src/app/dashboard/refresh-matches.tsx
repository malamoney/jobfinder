"use client";

import { useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { createMatchesReturn, type ReturnEnv } from "./matches-return";

const STALE_KEY = "matches:stale";

/**
 * One per tab, outside React: the island mounts, unmounts, and re-mounts
 * around every Posting the User opens (and twice per mount under React's dev
 * double-invoke), so what it needs to carry across those — the offset the list
 * was left at, and whether a `popstate` is what brought it back — lives here.
 */
const matchesReturn = createMatchesReturn();

/**
 * Whether the tab's `popstate` listener is in place. The list is not mounted
 * when the User steps back to it, so the step has to be noted by a listener
 * that outlives the island; registered on the first mount rather than at
 * import, so loading this module has no side effect and HMR cannot stack
 * listeners. Before the first mount there is nothing to return to anyway.
 */
let noting = false;

function noteTraversals(): void {
  if (noting) return;
  noting = true;
  // The browser has already set `location` to the entry being traversed to
  // when `popstate` fires.
  window.addEventListener("popstate", () => {
    matchesReturn.noteTraversal(listUrl());
  });
}

function listUrl(): string {
  return window.location.pathname + window.location.search;
}

function takeStale(): boolean {
  try {
    if (sessionStorage.getItem(STALE_KEY) !== "1") return false;
    sessionStorage.removeItem(STALE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Settles the matches list when the User comes back to it from a Posting they
 * just opened: puts the scroll back where they left it, then pulls a fresh
 * render so the card shows its "Viewed" tag. `matches-return.ts` has the
 * sequence and why it is ordered this way (#97, #99, #142); this island only
 * hands it the window and the router.
 *
 * The restore runs before paint (`useLayoutEffect`) so the User never sees
 * the top; the refresh runs after (`useEffect`) so the restored frame paints
 * before the server round trip begins. `router.refresh()` merges the new
 * render in place without moving the scroll — it is `markViewedAction`'s
 * `revalidatePath("/dashboard")` that would have cost the offset, which is
 * why the Posting page sets a flag instead and this acts on it.
 */
export function RefreshMatches() {
  const router = useRouter();

  useLayoutEffect(() => {
    matchesReturn.restore(env(router));
  }, [router]);

  useEffect(() => {
    noteTraversals();
    matchesReturn.settle(env(router));

    const url = listUrl();
    const noteScroll = () => {
      // Still listening while the commit that leaves for a Posting settles:
      // the router has already moved the URL and scrolled to the top, but this
      // cleanup runs a task later, and a scroll event in between would record
      // the top as where the User left the list. The URL says it is not.
      if (listUrl() === url) matchesReturn.noteScroll(url, window.scrollY);
    };
    window.addEventListener("scroll", noteScroll, { passive: true });
    return () => window.removeEventListener("scroll", noteScroll);
  }, [router]);

  return null;
}

function env(router: ReturnType<typeof useRouter>): ReturnEnv {
  return {
    url: listUrl(),
    scrollY: () => window.scrollY,
    scrollTo: (y) => window.scrollTo(0, y),
    refresh: () => router.refresh(),
    takeStale,
  };
}

/** Called from the Posting page so the matches list refreshes on return. */
export function markMatchesStale() {
  try {
    sessionStorage.setItem(STALE_KEY, "1");
  } catch {
    // No storage — the tag just waits for the next full render of the list.
  }
}
