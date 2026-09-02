"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "← Back to matches" that steps back through history rather than pushing a
 * fresh `/dashboard`.
 *
 * A Posting is almost always opened by clicking a card on the matches list, so
 * a history step back lands there — and the browser then restores the scroll
 * offset the User was at and the filter they had, neither of which a forward
 * navigation to `/dashboard` keeps. The `href` stays `/dashboard` so
 * middle-click and "open in new tab" still work, and a Posting opened cold in a
 * fresh tab (nothing to step back to) falls through to that plain navigation.
 */
export function BackToMatches() {
  const router = useRouter();

  return (
    <Link
      href="/dashboard"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        if (window.history.length > 1) {
          event.preventDefault();
          router.back();
        }
      }}
      className="self-start text-[12.5px] text-label hover:text-text"
    >
      ← Back to matches
    </Link>
  );
}
