"use client";

import { useEffect } from "react";
import { markViewedAction } from "./actions";

/**
 * Records that the User opened this Posting — once, when the page mounts in the
 * browser.
 *
 * A client effect rather than a write inside the Server Component, so it fires
 * only on a real visit: never on the server render, never on a route prefetch
 * when the User only hovered the card. Fire-and-forget — the "Viewed" tag on
 * the matches list is a convenience, and a failed mark must not surface.
 */
export function MarkViewed({ postingId }: { postingId: string }) {
  useEffect(() => {
    markViewedAction(postingId).catch(() => {});
  }, [postingId]);

  return null;
}
