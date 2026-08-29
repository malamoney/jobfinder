"use server";

import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { setNotes, setStatus } from "@/operations";
import type { ReviewOutcome } from "@/review/schema";

/**
 * What the review controls post to.
 *
 * Reachable by a direct POST, not only through the controls, so each checks for
 * a User itself. They answer with an outcome rather than redirecting — reviewing
 * a Posting is something done on the page it is already open on, and a session
 * that ended mid-review is one more message in the same place.
 */

const ENDED: ReviewOutcome = {
  ok: false,
  message: "Your session has ended. Log in and try again.",
};

export async function setStatusAction(
  postingId: string,
  status: unknown,
): Promise<ReviewOutcome> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) return ENDED;

  return setStatus(signedIn.id, postingId, status);
}

export async function setNotesAction(
  postingId: string,
  notes: unknown,
): Promise<ReviewOutcome> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) return ENDED;

  return setNotes(signedIn.id, postingId, notes);
}
