"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleSavedAction } from "./actions";

/**
 * The Save / Saved control in the corner of a Dashboard card (#63).
 *
 * "Saved" is the `interested` Status; clicking toggles it against `new`. The
 * label flips optimistically and the card is refreshed once the Server Action
 * lands, so a filtered view catches up. A failed write rolls the label back and
 * shows a short note under the button rather than taking the page down.
 *
 * One island per card, so a slow toggle on one card never blocks another.
 */
export function SavedToggle({
  postingId,
  saved: savedByServer,
}: {
  postingId: string;
  /** The Status the server last knew — `true` when it is `interested`. */
  saved: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(savedByServer);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !saved;
    setSaved(next);
    setFailed(false);
    start(async () => {
      try {
        const outcome = await toggleSavedAction(postingId, next);
        if (outcome.ok) {
          router.refresh();
        } else {
          setSaved(!next);
          setFailed(true);
        }
      } catch {
        setSaved(!next);
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={`flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${
          saved
            ? "border-accent-edge bg-accent-wash text-accent-text"
            : "border-border text-text-body"
        }`}
      >
        <BookmarkIcon filled={saved} />
        {saved ? "Saved" : "Save"}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-danger">
          Could not save that.
        </span>
      )}
    </span>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M4 2.5h8a.5.5 0 0 1 .5.5v10.5L8 11l-4.5 3V3a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}
