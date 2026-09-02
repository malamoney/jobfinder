"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STALE_KEY = "matches:stale";

/**
 * Intent carried outside React: set when the stale flag is first seen, cleared
 * when the refresh fires. `RefreshMatches` mounts, unmounts, and re-mounts in
 * quick succession on a back navigation (React's dev double-invoke, and the
 * navigation itself), so a per-mount timer or a piece of component state would
 * be dropped between the two mounts — a module flag survives it.
 */
let armed = false;

/**
 * Pulls a fresh render of the matches list when the User comes back from a
 * Posting they just opened, so its card shows the "Viewed" tag.
 *
 * `markViewedAction` deliberately does not `revalidatePath("/dashboard")` —
 * that drops the list from the router's back/forward cache, so "← Back to
 * matches" re-fetches it and loses the scroll position (#97). Instead
 * `MarkViewed` sets a `sessionStorage` flag and this reads it on return and
 * calls `router.refresh()`, which merges the new server render in place without
 * moving the scroll. The call is deferred a beat so it lands after the back
 * navigation has committed.
 */
export function RefreshMatches() {
  const router = useRouter();

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STALE_KEY) === "1") {
        sessionStorage.removeItem(STALE_KEY);
        armed = true;
      }
    } catch {
      return;
    }
    if (!armed) return;

    const id = window.setTimeout(() => {
      if (!armed) return;
      armed = false;
      router.refresh();
    }, 300);
    return () => window.clearTimeout(id);
  }, [router]);

  return null;
}

/** Called from the Posting page so the matches list refreshes on return. */
export function markMatchesStale() {
  try {
    sessionStorage.setItem(STALE_KEY, "1");
  } catch {
    // No storage — the tag just waits for the next full render of the list.
  }
}
