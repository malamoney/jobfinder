import { z } from "zod";

/**
 * Review State: a User's own relationship to a Posting — its Status and their
 * Notes.
 *
 * One schema, imported by the review controls in the browser and the server
 * actions behind them, so the two cannot disagree about what a Status may be or
 * how long a note may run. Nothing is behind this module (no database, no
 * `next`), which is what lets the same rules run on both sides.
 *
 * Review State is owned by the User and never recomputed — a Fetch that rewrites
 * a Posting, or an expiry that marks it dead, leaves it untouched (CONTEXT.md).
 */

/**
 * Where a Posting sits in a User's review pipeline. The four values
 * `CONTEXT.md` defines, in the order the controls present them.
 *
 * Canonical here rather than in `@/db/schema` because the client controls need
 * them and cannot import the database schema; `@/db/schema` imports this type
 * for the column that stores a Status.
 */
export const REVIEW_STATUSES = [
  "new",
  "interested",
  "not_interested",
  "applied",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Where every Posting sits before the User has touched it. */
export const DEFAULT_STATUS: ReviewStatus = "new";

/**
 * The Statuses a User can set. `new` is the absence of a decision — every
 * Posting starts there and there is no control that puts it back — so it is not
 * something the form is allowed to send.
 */
export const SETTABLE_STATUSES = [
  "interested",
  "not_interested",
  "applied",
] as const satisfies readonly ReviewStatus[];

export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/** How each Status reads to a person. */
export const STATUS_LABELS: Record<ReviewStatus, string> = {
  new: "New",
  interested: "Interested",
  not_interested: "Not interested",
  applied: "Applied",
};

/** The longest a note may run, so a crafted POST cannot store megabytes. */
export const MAX_NOTES_LENGTH = 10_000;

/** Shown when a note was rejected but no issue carried a message of its own. */
export const NOTES_FALLBACK_MESSAGE = "That note could not be saved.";

const MESSAGES = {
  notesTooLong: "That note is longer than Jobfinder can store.",
  unknownStatus: "That is not a status a posting can be set to.",
} as const;

/** A Status the controls are allowed to set. */
export const settableStatusInput = z.enum(SETTABLE_STATUSES, {
  message: MESSAGES.unknownStatus,
});

/**
 * A note, normalized: trailing whitespace trimmed, so a note that is only
 * spaces clears the field. Everything else is kept exactly, since Notes are
 * freeform. Used by the schema below and by the controls to tell whether the
 * field has really changed.
 */
export function normalizedNotes(value: string): string {
  return value.replace(/\s+$/, "");
}

/** A note as typed, capped in length and normalized. */
export const notesInput = z
  .string()
  .max(MAX_NOTES_LENGTH, MESSAGES.notesTooLong)
  .transform(normalizedNotes);

export type NotesInput = z.input<typeof notesInput>;

/**
 * A User's Review State for one Posting, in the shape a page renders.
 *
 * Lives here, in the half with no database behind it, so the review controls in
 * the browser can be typed by it. `statusChangedAt` is null until the Status has
 * been moved off `new`; `appliedAt` is null until it has been `applied` at least
 * once.
 */
export type PostingReview = {
  status: ReviewStatus;
  notes: string;
  statusChangedAt: Date | null;
  appliedAt: Date | null;
};

/** What setting a Status or saving a note answers with. */
export type ReviewOutcome =
  | { ok: true }
  | { ok: false; message: string };

/**
 * The first thing wrong with a note, phrased for the person who wrote it, or
 * nothing if it is fine.
 */
export function notesProblem(input: unknown): string | null {
  const parsed = notesInput.safeParse(input);
  if (parsed.success) return null;

  return parsed.error.issues[0]?.message ?? NOTES_FALLBACK_MESSAGE;
}
