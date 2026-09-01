import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { criteria, type CriteriaRow } from "@/db/schema";
import {
  criteriaInput,
  CRITERIA_FALLBACK_MESSAGE,
  type Criteria,
  type CriteriaOutcome,
} from "@/criteria/schema";
import { matchCriteria } from "./matching";

/**
 * Reading and writing a User's Criteria.
 *
 * Part of the primary seam (see `./index.ts`): the form posts through
 * `saveCriteria`, the Criteria page reads through `readCriteria`, and Matching
 * (#9) reads the same row. The Zod schema in `@/criteria/schema` is the single
 * contract — this module never re-decides what is valid, it only stores what
 * the schema passed.
 */

/** The stored values in the shape the schema and the form both speak. */
function fromRow(row: CriteriaRow): Criteria {
  return {
    titles: row.titles,
    keywords: row.keywords,
    arrangements: row.arrangements,
    homeLocation: row.homeLocation,
    radiusMiles: row.radiusMiles,
    minSalary: row.minSalary,
  };
}

/** A User's stated Criteria, or null if they have not stated any yet. */
export async function readCriteria(userId: string): Promise<Criteria | null> {
  const [row] = await getDb()
    .select()
    .from(criteria)
    .where(eq(criteria.userId, userId));

  return row ? fromRow(row) : null;
}

/**
 * Validates what a User entered and stores it, replacing whatever they had
 * stated before.
 *
 * An upsert on the User's id rather than an insert-or-update dance: the table
 * holds one row per User, so revising Criteria is overwriting that row. The
 * earlier statement is not kept — Matching only ever wants the current one,
 * and #2 defers "named searches" to a later UI.
 *
 * Re-matches the whole Corpus before returning, so a User who saves a Criteria
 * change sees its effect on the next Dashboard load rather than waiting for the
 * nightly Fetch (#2, user story 19). Every matching stage is free, so this is
 * unconditional.
 */
export async function saveCriteria(
  userId: string,
  input: unknown,
): Promise<CriteriaOutcome> {
  const parsed = criteriaInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? CRITERIA_FALLBACK_MESSAGE,
    };
  }

  const values = parsed.data;
  const [row] = await getDb()
    .insert(criteria)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: criteria.userId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  await matchCriteria(userId);

  return { ok: true, criteria: fromRow(row) };
}
