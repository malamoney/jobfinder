"use client";

import { useEffect } from "react";
import { markMatchesStale } from "../../dashboard/refresh-matches";
import { markViewedAction } from "./actions";

/**
 * Records that the User opened this Posting — once, when the page mounts in the
 * browser.
 *
 * A client effect rather than a write inside the Server Component, so it fires
 * only on a real visit: never on the server render, never on a route prefetch
 * when the User only hovered the card. Fire-and-forget — the "Viewed" tag on
 * the matches list is a convenience, and a failed mark must not surface.
 *
 * Also flags the matches list as stale, so it refreshes itself in place when
 * the User goes back (`RefreshMatches`) — the action does not
 * `revalidatePath("/dashboard")` because that would cost the scroll position.
 */
export function MarkViewed({ postingId }: { postingId: string }) {
  useEffect(() => {
    markViewedAction(postingId)
      .then(() => markMatchesStale())
      .catch(() => {});
  }, [postingId]);

  return null;
}
