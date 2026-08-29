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
import { formatDay } from "../../format";
import { setNotesAction, setStatusAction } from "./actions";

/** Shown when a write fails for a reason that is not a validation message. */
const INFRA_FAILURE = "Something went wrong saving that. Try again in a moment.";

type ReviewControlsProps = {
  postingId: string;
  /** The Review State as the server last knew it. */
  review: PostingReview;
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
export function ReviewControls({ postingId, review }: ReviewControlsProps) {
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
    <section className="flex flex-col gap-6 rounded-lg border border-gray-200 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Your review</h2>
          <span className="text-xs text-gray-500">
            {STATUS_LABELS[review.status]}
            {review.status === "applied" && review.appliedAt
              ? ` · ${formatDay(review.appliedAt)}`
              : ""}
          </span>
        </div>
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
                className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
                  active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300"
                }`}
              >
                {STATUS_LABELS[status]}
              </button>
            );
          })}
        </div>
        <p role="alert" aria-live="polite" className="text-sm text-red-700">
          {statusError}
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Notes</span>
        <textarea
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setSavedNotes(false);
            setNotesError(null);
          }}
          rows={4}
          placeholder="A contact name, a referral, why you passed."
          className="rounded-md border border-gray-300 px-3 py-2 text-base"
        />
        <p role="alert" aria-live="polite" className="text-sm text-red-700">
          {notesError}
        </p>
        {savedNotes && !notesChanged && (
          <p aria-live="polite" className="text-sm text-green-700">
            Saved.
          </p>
        )}
        <button
          type="button"
          onClick={saveNotes}
          disabled={pendingNotes || !notesChanged}
          className="self-start rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {pendingNotes ? "Saving…" : "Save notes"}
        </button>
      </label>
    </section>
  );
}
