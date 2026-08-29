import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  criteria,
  geocodes,
  postings,
  reviewState,
  type Posting,
} from "@/db/schema";
import {
  DEFAULT_STATUS,
  notesInput,
  NOTES_FALLBACK_MESSAGE,
  settableStatusInput,
  type PostingReview,
  type ReviewOutcome,
} from "@/review/schema";
import { latestGroupReview } from "./dedup";
import { hasUnresolvedLocation, isExpired } from "./postings";

/**
 * Reading and writing a User's Review State.
 *
 * Part of the primary seam (see `./index.ts`). Review State is the one thing a
 * Fetch never touches: these operations write `review_state`, and nothing in
 * ingestion or expiry does, so a Status and its Notes outlive every rewrite of
 * the Posting they hang off (#2, required coverage).
 *
 * A row is created lazily — the first time a User sets a Status or writes a
 * note. Until then the Posting is `new` with no Notes, which is what
 * `readPosting` returns when it finds no row.
 */

/** A Posting in full, with the signed-in User's Review State attached. */
export type PostingDetails = Posting & {
  expired: boolean;
  /** Whether the Posting names a place that could not be geocoded (#12). */
  unresolvedLocation: boolean;
  review: PostingReview;
};

/** The state every Posting is in before the User has touched it. */
const UNREVIEWED: PostingReview = {
  status: DEFAULT_STATUS,
  notes: "",
  statusChangedAt: null,
  appliedAt: null,
};

/** Whether a string could be a Posting's id, before it reaches a `uuid` column. */
function isPostingId(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

/**
 * Reads one Posting with the User's Review State, or null if no such Posting is
 * in the Corpus.
 *
 * The Corpus is shared, so any Posting is readable by any User — what is
 * per-User is the Review State. That state belongs to the opening, not the
 * listing: it is read across the Posting's whole Dedup Key group (#13), so a
 * User who marked one Source's copy sees that mark on the page for any other
 * copy of the same opening. `setStatus` and `setNotes` still write against a
 * single Posting — the one the User is looking at — and this read is what makes
 * the group agree.
 */
export async function readPosting(
  userId: string,
  postingId: string,
): Promise<PostingDetails | null> {
  if (!isPostingId(postingId)) return null;

  const db = getDb();

  const [stated] = await db
    .select({ radiusMiles: criteria.radiusMiles })
    .from(criteria)
    .where(eq(criteria.userId, userId));
  const filtersByDistance = stated?.radiusMiles != null;

  const [row] = await db
    .select({
      posting: postings,
      coordinate: {
        latitude: geocodes.latitude,
        longitude: geocodes.longitude,
      },
    })
    .from(postings)
    .leftJoin(geocodes, eq(geocodes.location, postings.normalizedLocation))
    .where(eq(postings.id, postingId));

  if (!row) return null;

  const marks = await db
    .select({
      status: reviewState.status,
      notes: reviewState.notes,
      statusChangedAt: reviewState.statusChangedAt,
      appliedAt: reviewState.appliedAt,
      updatedAt: reviewState.updatedAt,
    })
    .from(reviewState)
    .innerJoin(postings, eq(postings.id, reviewState.postingId))
    .where(
      and(
        eq(reviewState.userId, userId),
        eq(postings.dedupKey, row.posting.dedupKey),
      ),
    );
  const effective = latestGroupReview(marks);

  return {
    ...row.posting,
    expired: isExpired(row.posting),
    unresolvedLocation: hasUnresolvedLocation(
      row.posting,
      row.coordinate,
      filtersByDistance,
    ),
    review: effective
      ? {
          status: effective.status,
          notes: effective.notes,
          statusChangedAt: effective.statusChangedAt,
          appliedAt: effective.appliedAt,
        }
      : UNREVIEWED,
  };
}

/**
 * Sets a Posting's Status for a User.
 *
 * The Status is a single value, so this is a plain overwrite — there is no
 * combination of Statuses to reconcile, and changing one's mind is setting it
 * again. `applied_at` is written whenever the Status becomes `applied` and left
 * alone otherwise, so moving away from `applied` and back updates the date a
 * User is waiting from without a detour through `new`.
 *
 * `new` is not settable: it is the starting state, not a decision, and nothing
 * offers a way back to it.
 */
export async function setStatus(
  userId: string,
  postingId: string,
  status: unknown,
): Promise<ReviewOutcome> {
  const parsed = settableStatusInput.safeParse(status);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "That status is not allowed.",
    };
  }

  const missing = await postingMissing(postingId);
  if (missing) return missing;

  const value = parsed.data;
  const now = new Date();
  const appliedAt = value === "applied" ? now : undefined;

  await getDb()
    .insert(reviewState)
    .values({
      userId,
      postingId,
      status: value,
      statusChangedAt: now,
      appliedAt: appliedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [reviewState.userId, reviewState.postingId],
      set: {
        status: value,
        statusChangedAt: now,
        updatedAt: now,
        // Only touched on the way into `applied`, so the date survives a later
        // move away from it.
        ...(appliedAt ? { appliedAt } : {}),
      },
    });

  return { ok: true };
}

/**
 * Saves a User's Notes on a Posting, replacing whatever was there.
 *
 * Notes are freeform, so validation only caps the length; a note that is only
 * whitespace clears the field. A row created here alone keeps the default `new`
 * Status, which was never "changed" — so `status_changed_at` stays null.
 */
export async function setNotes(
  userId: string,
  postingId: string,
  notes: unknown,
): Promise<ReviewOutcome> {
  const parsed = notesInput.safeParse(notes);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? NOTES_FALLBACK_MESSAGE,
    };
  }

  const missing = await postingMissing(postingId);
  if (missing) return missing;

  await getDb()
    .insert(reviewState)
    .values({ userId, postingId, notes: parsed.data })
    .onConflictDoUpdate({
      target: [reviewState.userId, reviewState.postingId],
      set: { notes: parsed.data, updatedAt: new Date() },
    });

  return { ok: true };
}

/**
 * A refusal if the Posting is not in the Corpus, or nothing if it is.
 *
 * The foreign key would catch a missing row too, but as a thrown constraint
 * error that reaches an error boundary; a direct POST with a stale or invented
 * id gets a sentence instead. An id that is not even a UUID is turned away here
 * rather than left to error inside the query.
 */
async function postingMissing(
  postingId: string,
): Promise<{ ok: false; message: string } | null> {
  const gone = { ok: false, message: "That posting no longer exists." } as const;

  if (!isPostingId(postingId)) return gone;

  const [row] = await getDb()
    .select({ id: postings.id })
    .from(postings)
    .where(eq(postings.id, postingId));

  return row ? null : gone;
}
