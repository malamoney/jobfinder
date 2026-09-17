"use server";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { saveCriteria } from "@/operations";
import type { CriteriaOutcome } from "@/criteria/schema";
import { matchedPostingsUserTag } from "../dashboard/matched-postings-cache";

/**
 * What the Criteria form posts to.
 *
 * Reachable by a direct POST, not only through the form, so it checks for a
 * User itself rather than trusting the page to have done it. The form keeps
 * its own state, so this answers with an outcome instead of redirecting — a
 * save is a thing you do on the page you are already on, and a session that
 * ended while the form was open is one more message in the same place the
 * validation messages appear.
 *
 * A successful save expires the User's own entry in the matched Postings
 * cache (#155) with `updateTag` — the read-your-own-writes primitive, so the
 * Dashboard link the form shows next renders the matches this save just
 * produced rather than the ones from before it.
 */
export async function saveCriteriaAction(
  _previous: CriteriaOutcome | null,
  input: unknown,
): Promise<CriteriaOutcome> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) {
    return { ok: false, message: "Your session has ended. Log in and try again." };
  }

  const outcome = await saveCriteria(signedIn.id, input);
  if (outcome.ok) updateTag(matchedPostingsUserTag(signedIn.id));
  return outcome;
}
