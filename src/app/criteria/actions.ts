"use server";

import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { saveCriteria } from "@/operations";
import type { CriteriaOutcome } from "@/criteria/schema";

/**
 * What the Criteria form posts to.
 *
 * Reachable by a direct POST, not only through the form, so it checks for a
 * User itself rather than trusting the page to have done it. The form keeps
 * its own state, so this answers with an outcome instead of redirecting — a
 * save is a thing you do on the page you are already on, and a session that
 * ended while the form was open is one more message in the same place the
 * validation messages appear.
 */
export async function saveCriteriaAction(
  _previous: CriteriaOutcome | null,
  input: unknown,
): Promise<CriteriaOutcome> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) {
    return { ok: false, message: "Your session has ended. Log in and try again." };
  }

  return saveCriteria(signedIn.id, input);
}
