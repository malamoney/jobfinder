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

if (typeof window !== "undefined") {
  // The list is not mounted when the User steps back to it, so the step is
  // noted here and read by the mount it causes. The browser has already set
  // `location` to the entry being traversed to when `popstate` fires.
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
 * render so the card shows its "Viewed" tag (`matches-return.ts` has the
 * sequence and why it is ordered this way).
 *
 * `markViewedAction` deliberately does not `revalidatePath("/dashboard")` —
 * that drops the list from the router's back/forward cache, so "← Back to
 * matches" re-fetches it and loses the scroll position (#97). Instead
 * `MarkViewed` sets a `sessionStorage` flag and this reads it on return and
 * calls `router.refresh()`, which merges the new server render in place
 * without moving the scroll — provided the scroll has already been put back,
 * which is why the restore runs before paint and the refresh after it (#142).
 */
export function RefreshMatches() {
  const router = useRouter();

  useLayoutEffect(() => {
    matchesReturn.restore(env(router));
  }, [router]);

  useEffect(() => {
    matchesReturn.settle(env(router));

    const url = listUrl();
    const noteScroll = () => matchesReturn.noteScroll(url, window.scrollY);
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
