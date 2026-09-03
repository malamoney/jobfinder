import { and, eq, sql } from "drizzle-orm";
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
  type ReviewStatus,
} from "@/review/schema";
import { latestGroupReview } from "./dedup";
import { hasUnresolvedLocation, isExpired, isPostingId } from "./postings";

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
 * Records that the User has opened this Posting's detail page.
 *
 * Writes only `viewed_at`, and keeps the first open (`coalesce`) — not
 * `status`, not `updated_at`. So a viewed Posting still reads as `new`, viewing
 * never counts against `unreviewedCount`, and opening one listing of an opening
 * cannot outrank a decision the User made on another (`latestGroupReview` sorts
 * on `updated_at`).
 *
 * Called fire-and-forget from the detail page, so a Posting that vanished
 * between the page rendering and this landing is a no-op rather than an error.
 * Returns nothing — there is no outcome a caller acts on.
 */
export async function markViewed(
  userId: string,
  postingId: string,
): Promise<void> {
  if (await postingMissing(postingId)) return;

  const now = new Date();
  await getDb()
    .insert(reviewState)
    .values({ userId, postingId, viewedAt: now })
    .onConflictDoUpdate({
      target: [reviewState.userId, reviewState.postingId],
      set: { viewedAt: sql`coalesce(${reviewState.viewedAt}, ${now})` },
    });
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

  await writeReviewState(userId, postingId, {
    status: value,
    statusChangedAt: now,
    appliedAt,
  });

  return { ok: true };
}

/**
 * The Save toggle on a Dashboard card: the one quick verb a card offers, mapped
 * onto the `interested` Status.
 *
 * Saved is `status === "interested"`. Saving sets it; un-saving returns the
 * Posting to `new` — the "changed my mind" path the review buttons deliberately
 * do not offer, because on the detail page a User picks another Status instead.
 * From a card there is nowhere else to land, so `new` has to be reachable here.
 *
 * `statusChangedAt` tracks the toggle both ways: a timestamp when saved, back to
 * null when un-saved, so a Posting returned to `new` reads as untouched again.
 *
 * The toggle only acts on a Posting that is genuinely `new` or was saved from a
 * card (`interested` with no `applied` date). A Posting the User has moved
 * further down the pipeline — `applied`, `not_interested`, or `interested` after
 * having applied — is refused: the card shows a Status pill rather than the
 * toggle for exactly these, and a stray write from a stale tab or a direct POST
 * must not quietly undo a decision or strand its `applied` date.
 */
export async function setSaved(
  userId: string,
  postingId: string,
  saved: unknown,
): Promise<ReviewOutcome> {
  if (typeof saved !== "boolean") {
    return { ok: false, message: "That is not a value Save can be set to." };
  }

  const missing = await postingMissing(postingId);
  if (missing) return missing;

  const existing = await currentReview(userId, postingId);
  const togglable =
    !existing ||
    existing.status === "new" ||
    (existing.status === "interested" && existing.appliedAt === null);
  if (!togglable) {
    return {
      ok: false,
      message: "That posting already has a review status. Open it to change it.",
    };
  }

  const now = new Date();
  await writeReviewState(
    userId,
    postingId,
    saved
      ? { status: "interested", statusChangedAt: now }
      : { status: DEFAULT_STATUS, statusChangedAt: null },
  );

  return { ok: true };
}

/** The signed-in User's own Review State row for one Posting, or null. */
async function currentReview(
  userId: string,
  postingId: string,
): Promise<{ status: ReviewStatus; appliedAt: Date | null } | null> {
  const [row] = await getDb()
    .select({ status: reviewState.status, appliedAt: reviewState.appliedAt })
    .from(reviewState)
    .where(
      and(
        eq(reviewState.userId, userId),
        eq(reviewState.postingId, postingId),
      ),
    );
  return row ?? null;
}

/**
 * The one write path for a Review State row's Status.
 *
 * `setStatus` and `setSaved` both land here so a change to how these rows are
 * stored is made once. `appliedAt` is only ever written on the way into
 * `applied` — passed then, left out otherwise — so the date a User is waiting
 * from survives every later move, including back to `new`.
 */
async function writeReviewState(
  userId: string,
  postingId: string,
  set: {
    status: ReviewStatus;
    statusChangedAt: Date | null;
    appliedAt?: Date;
  },
): Promise<void> {
  const { status, statusChangedAt, appliedAt } = set;

  await getDb()
    .insert(reviewState)
    .values({
      userId,
      postingId,
      status,
      statusChangedAt,
      appliedAt: appliedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [reviewState.userId, reviewState.postingId],
      set: {
        status,
        statusChangedAt,
        updatedAt: new Date(),
        ...(appliedAt ? { appliedAt } : {}),
      },
    });
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
