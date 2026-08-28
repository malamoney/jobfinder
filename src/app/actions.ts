"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, logIn, signUp, type AuthOutcome } from "@/auth";

/**
 * What the credential forms post to.
 *
 * Server actions rather than fetches to the auth endpoints, so a browser with
 * no JavaScript can still sign in: the form posts, the action runs, the cookie
 * comes back on the response.
 *
 * `redirect` throws by design in Next, so it is called after the outcome is
 * known and never inside a try.
 */

/** Where a User lands once they are logged in. */
const AFTER_AUTH = "/dashboard";

export async function signUpAction(
  _previous: AuthOutcome | null,
  form: FormData,
): Promise<AuthOutcome> {
  const outcome = await signUp(Object.fromEntries(form));
  if (!outcome.ok) return outcome;
  redirect(AFTER_AUTH);
}

export async function logInAction(
  _previous: AuthOutcome | null,
  form: FormData,
): Promise<AuthOutcome> {
  const outcome = await logIn(Object.fromEntries(form));
  if (!outcome.ok) return outcome;
  redirect(AFTER_AUTH);
}

export async function logOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
