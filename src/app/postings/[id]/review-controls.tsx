"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// Not "@/operations": that reaches Postgres. This is the schema half with
// nothing behind it, so the same rules answer here and on the server.
import {
  normalizedNotes,
  notesProblem,
  SETTABLE_STATUSES,
  STATUS_LABELS,
  type PostingReview,
  type SettableStatus,
} from "@/review/schema";
import { MonoLabel } from "../../mono-label";
import { setNotesAction, setStatusAction } from "./actions";

/** Shown when a write fails for a reason that is not a validation message. */
const INFRA_FAILURE = "Something went wrong saving that. Try again in a moment.";

type ReviewControlsProps = {
  postingId: string;
  /** The Review State as the server last knew it. */
  review: PostingReview;
  /**
   * What sits above the Status buttons: the "YOUR REVIEW" caption and the
   * Status kicker, on a Posting with no commute tab to switch to.
   *
   * Passed in rather than rendered here because a Posting that *is* a commute
   * puts a tab strip there instead, and a tab strip may not live inside the
   * panel it controls. Left out, the buttons are the first thing in the panel —
   * which is what the tabbed layout wants (canvas 4a).
   */
  heading?: React.ReactNode;
};

/**
 * The Status buttons and the Notes field on a Posting's page.
 *
 * The Status is set straight through a Server Action and the page is then
 * refreshed, so what shows always matches what is stored — including the applied
 * date, which the server writes. Notes keep local state while being typed and
 * save on demand.
 *
 * Both writes are wrapped: an infrastructure failure is caught and shown in the
 * same place a validation message would appear, rather than reaching the error
 * boundary and taking the page down.
 */
export function ReviewControls({
  postingId,
  review,
  heading,
}: ReviewControlsProps) {
  const router = useRouter();
  const [pendingStatus, startStatus] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);

  const [notes, setNotes] = useState(review.notes);
  const [pendingNotes, startNotes] = useTransition();
  const [notesError, setNotesError] = useState<string | null>(null);
  const [savedNotes, setSavedNotes] = useState(false);

  function chooseStatus(next: SettableStatus) {
    setStatusError(null);
    startStatus(async () => {
      try {
        const outcome = await setStatusAction(postingId, next);
        if (outcome.ok) router.refresh();
        else setStatusError(outcome.message);
      } catch {
        setStatusError(INFRA_FAILURE);
      }
    });
  }

  function saveNotes() {
    const problem = notesProblem(notes);
    setNotesError(problem);
    setSavedNotes(false);
    if (problem) return;

    startNotes(async () => {
      try {
        const outcome = await setNotesAction(postingId, notes);
        if (outcome.ok) {
          setSavedNotes(true);
          router.refresh();
        } else {
          setNotesError(outcome.message);
        }
      } catch {
        setNotesError(INFRA_FAILURE);
      }
    });
  }

  const notesChanged = normalizedNotes(notes) !== review.notes;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-2.5">
        {heading}
        <div className="flex flex-wrap gap-2">
          {SETTABLE_STATUSES.map((status) => {
            const active = review.status === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => chooseStatus(status)}
                disabled={pendingStatus}
                aria-pressed={active}
                className={`rounded-control border px-3.5 py-[7px] text-[12.5px] disabled:opacity-60 ${
                  active
                    ? "border-accent-edge bg-accent-wash text-accent-text"
                    : "border-border text-label"
                }`}
              >
                {STATUS_LABELS[status]}
              </button>
            );
          })}
        </div>
        <p role="alert" aria-live="polite" className="text-[12.5px] text-danger">
          {statusError}
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <MonoLabel>Notes</MonoLabel>
        <textarea
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setSavedNotes(false);
            setNotesError(null);
          }}
          rows={4}
          placeholder="A contact name, a referral, why you passed."
          className="rounded-control border border-border bg-field px-3 py-2.5 text-[13.5px] text-text"
        />
        <p role="alert" aria-live="polite" className="text-[12.5px] text-danger">
          {notesError}
        </p>
        {savedNotes && !notesChanged && (
          <p aria-live="polite" className="text-[12.5px] text-ok">
            Saved.
          </p>
        )}
        <button
          type="button"
          onClick={saveNotes}
          disabled={pendingNotes || !notesChanged}
          className="self-start rounded-control border border-border px-3.5 py-[7px] text-[12.5px] font-medium disabled:text-disabled"
        >
          {pendingNotes ? "Saving…" : "Save notes"}
        </button>
      </label>
    </div>
  );
}
