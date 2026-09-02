import { z } from "zod";
// Type-only, and erased: this module still has nothing behind it, and still
// runs unchanged in the browser.
import type { Placement } from "@/geocoding/nominatim";

/**
 * A User's stated Criteria: titles, keywords, accepted Arrangements, a home
 * location and radius, and a salary floor.
 *
 * One schema, imported by both the form and the server operation, so the two
 * cannot drift into disagreeing about what is acceptable — a client that
 * accepts what the server rejects is a form that fails with no explanation.
 * This module has nothing behind it (no database, no `next`), which is what
 * lets the same rules run in the browser and on the server.
 *
 * Strict: an unrecognised key is a rejection rather than something quietly
 * dropped. Nothing legitimate sends fields this does not name, so anything
 * that does is a stale client or someone probing.
 */

/**
 * How the work is performed. The five values `CONTEXT.md` defines, in the
 * order the form lists them.
 *
 * Canonical here rather than in `@/db/schema` because the form needs them and
 * the form cannot import the database schema. `@/db/schema` imports this type
 * for the column that stores the accepted set.
 */
export const ARRANGEMENTS = [
  "full-time",
  "part-time",
  "remote",
  "onsite",
  "hybrid",
] as const;

export type Arrangement = (typeof ARRANGEMENTS)[number];

/**
 * The two axes an Arrangement selection is read along (#11): where the work
 * happens, and what the employment commitment is. They are independent — a User
 * who constrains one and leaves the other untouched is saying nothing about the
 * untouched one, not rejecting every value of it, and Matching filters each
 * axis separately on that basis (`src/operations/matching.ts`).
 *
 * The form groups its checkboxes by these; Matching splits a stated set by
 * them. One definition so the two cannot disagree about which value is which
 * axis.
 */
export const LOCATION_ARRANGEMENTS = [
  "remote",
  "onsite",
  "hybrid",
] as const satisfies readonly Arrangement[];

export const EMPLOYMENT_ARRANGEMENTS = [
  "full-time",
  "part-time",
] as const satisfies readonly Arrangement[];

/**
 * The Arrangements a distance bound applies to. An onsite or hybrid role the
 * User could not commute to should be excluded like the other; a remote role
 * ignores the radius entirely (`CONTEXT.md`, ADR 0001's funnel).
 *
 * Selecting either is therefore what makes a home location and radius
 * required — the fields the form shows only then.
 */
export const DISTANCE_ARRANGEMENTS = [
  "onsite",
  "hybrid",
] as const satisfies readonly Arrangement[];

/** The most items a list may hold, so a crafted POST cannot send millions. */
const MAX_LIST_ITEMS = 100;
/** The longest a single title or keyword may be. */
const MAX_ITEM_LENGTH = 200;

/** Shown when validation failed but no issue carried a message of its own. */
export const CRITERIA_FALLBACK_MESSAGE = "Check what you have entered.";

/** Said the way a person reads it, not the way a validator writes it. */
const MESSAGES = {
  titleBlank: "A job title cannot be blank.",
  titlesEmpty: "Add at least one job title.",
  keywordBlank: "A keyword cannot be blank.",
  tooManyItems: "That is a longer list than Jobfinder can work with.",
  itemTooLong: "That is too long to be a title or a keyword.",
  arrangementsEmpty: "Choose at least one kind of arrangement you would accept.",
  homeLocationNeeded:
    "Add your home address so onsite and hybrid roles can be limited by distance.",
  radiusNeeded:
    "Add a commute radius so onsite and hybrid roles can be limited by distance.",
  radiusWhole: "Radius must be a whole number of miles.",
  radiusPositive: "Radius must be more than zero miles.",
  salaryWhole: "Minimum salary must be a whole number.",
  salaryNonNegative: "Minimum salary cannot be negative.",
} as const;

/** A title or keyword: trimmed, non-empty, and not absurdly long. */
function listItem(blankMessage: string) {
  return z
    .string()
    .trim()
    .min(1, blankMessage)
    .max(MAX_ITEM_LENGTH, MESSAGES.itemTooLong);
}

/** Drops exact duplicates while keeping the order they were stated in. */
function deduped<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function acceptsDistanceRole(arrangements: readonly Arrangement[]): boolean {
  return arrangements.some((arrangement) =>
    (DISTANCE_ARRANGEMENTS as readonly Arrangement[]).includes(arrangement),
  );
}

export const criteriaInput = z
  .strictObject({
    titles: z
      .array(listItem(MESSAGES.titleBlank))
      .min(1, MESSAGES.titlesEmpty)
      .max(MAX_LIST_ITEMS, MESSAGES.tooManyItems),
    // Keywords are optional: a User can search on titles alone. An empty title
    // list is the only list the spec calls invalid.
    keywords: z
      .array(listItem(MESSAGES.keywordBlank))
      .max(MAX_LIST_ITEMS, MESSAGES.tooManyItems)
      .default([]),
    arrangements: z
      .array(z.enum(ARRANGEMENTS))
      .min(1, MESSAGES.arrangementsEmpty)
      // Five distinct values exist; a longer array is a crafted POST, and it
      // should be turned away before `deduped` and the refine walk it.
      .max(ARRANGEMENTS.length, MESSAGES.tooManyItems),
    // Null unless a distance role is accepted; the refine below requires it
    // then, and the transform clears it otherwise so a stored home location
    // cannot outlive the reason it was asked for.
    homeLocation: z.string().trim().min(1).max(MAX_ITEM_LENGTH).nullish(),
    radiusMiles: z
      .number(MESSAGES.radiusWhole)
      .int(MESSAGES.radiusWhole)
      .positive(MESSAGES.radiusPositive)
      .nullish(),
    // Set or left blank (`CONTEXT.md`: a Posting with no stated salary always
    // passes, so a blank floor is not the same as a floor of zero).
    minSalary: z
      .number(MESSAGES.salaryWhole)
      .int(MESSAGES.salaryWhole)
      .nonnegative(MESSAGES.salaryNonNegative)
      .nullish(),
    // There is no "United States only" field: the Corpus holds only US-based
    // roles by ingestion policy (ADR 0010, superseding ADR 0009), so Matching
    // has nothing left to filter on that axis.
  })
  .superRefine((value, ctx) => {
    if (!value.arrangements || !acceptsDistanceRole(value.arrangements)) return;

    if (!value.homeLocation) {
      ctx.addIssue({
        code: "custom",
        path: ["homeLocation"],
        message: MESSAGES.homeLocationNeeded,
      });
    }
    if (value.radiusMiles == null) {
      ctx.addIssue({
        code: "custom",
        path: ["radiusMiles"],
        message: MESSAGES.radiusNeeded,
      });
    }
  })
  .transform((value) => {
    const distance = acceptsDistanceRole(value.arrangements);
    return {
      titles: deduped(value.titles),
      keywords: deduped(value.keywords),
      arrangements: deduped(value.arrangements),
      homeLocation: distance ? (value.homeLocation ?? null) : null,
      radiusMiles: distance ? (value.radiusMiles ?? null) : null,
      minSalary: value.minSalary ?? null,
    };
  });

/** What a form sends. Location, radius, and salary may be omitted or null. */
export type CriteriaInput = z.input<typeof criteriaInput>;

/** A User's Criteria, validated and normalized. */
export type Criteria = z.output<typeof criteriaInput>;

/**
 * The Home Coordinate: where a User's stated home location was placed, and how
 * precisely (#100, ADR 0014).
 *
 * Kept with the User's own Criteria rather than in the shared Geocode Cache, so
 * that a street address precise enough to be worth giving is not precise enough
 * to be pooled.
 *
 * A geocoder's Placement, named for what it is to a User — nothing is added to
 * it here, and two identical shapes with a copy between them would only be a
 * chance for the two to disagree.
 */
export type HomeCoordinate = Placement;

/**
 * What became of the home location a save was handed.
 *
 * Four answers, because the User is owed a different sentence for each: nothing
 * was stated; it was placed (at a street address, or only at a city, which the
 * form says out loud); the geocoder answered and knew no such place; or the
 * geocoder could not be reached at all. Only the last two leave the commute
 * radius unapplied, and neither is a reason to refuse the save — a geocoder's
 * ignorance must not lock a User out of their own search.
 */
export type HomeOutcome =
  | { state: "none" }
  | { state: "placed"; home: HomeCoordinate }
  | { state: "not-found" }
  | { state: "unchecked" };

/**
 * What reading or writing Criteria answers with.
 *
 * The shape the form renders, so it lives here in the half with no database
 * behind it. `criteria` on a success is the stored, normalized values, so the
 * form can show exactly what was kept, and `home` is what the save made of the
 * home location among them.
 */
export type CriteriaOutcome =
  | { ok: true; criteria: Criteria; home: HomeOutcome }
  | { ok: false; message: string };

/**
 * The first thing wrong with what was entered, phrased for the person who
 * entered it, or nothing if it is all fine.
 *
 * One message rather than a list: a form that lights up every field at once
 * reads as a scolding, and a person fixes one thing first anyway.
 */
export function criteriaProblem(input: unknown): string | null {
  const parsed = criteriaInput.safeParse(input);
  if (parsed.success) return null;

  return parsed.error.issues[0]?.message ?? CRITERIA_FALLBACK_MESSAGE;
}

/** Whether the form should be asking for a home location and radius. */
export function needsDistanceBounds(
  arrangements: readonly Arrangement[],
): boolean {
  return acceptsDistanceRole(arrangements);
}
