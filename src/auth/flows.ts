import { APIError } from "better-auth/api";
import { getAuth } from "./instance";
import {
  credentials,
  credentialsProblem,
  type AuthOutcome,
} from "./credentials";

/**
 * Signing up and logging in, as the forms need them.
 *
 * Both answer with an `AuthOutcome` rather than throwing: a failed login is an
 * ordinary outcome of using the application, not an exception, and the person
 * who typed the password needs a sentence rather than a stack.
 */

/**
 * better-auth's codes for the two failures a person can actually cause.
 *
 * Matched on the code rather than the message so a reworded library string
 * cannot turn a specific explanation into the generic fallback.
 */
const ALREADY_REGISTERED = "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";
const BAD_CREDENTIALS = "INVALID_EMAIL_OR_PASSWORD";

/**
 * A display name, until there is a screen on which to choose one.
 *
 * better-auth requires a name on the User, and #4 asks only for an email and a
 * password — so the local part stands in rather than a form field nobody asked
 * for. A profile screen can replace it without a migration.
 */
function nameFrom(email: string): string {
  return email.slice(0, email.indexOf("@")) || email;
}

/** Creates an account, and signs the new User straight in. */
export async function signUp(input: unknown): Promise<AuthOutcome> {
  const problem = credentialsProblem(input);
  if (problem) return { ok: false, message: problem };

  const { email, password } = credentials.parse(input);

  try {
    await getAuth().api.signUpEmail({
      body: { email, password, name: nameFrom(email) },
    });
    return { ok: true };
  } catch (error) {
    // Naming the address as taken is account enumeration, and #4 asks for it
    // anyway: a person who cannot tell "already registered" from "something
    // went wrong" is stuck on the signup form with no way forward. The login
    // path below gives nothing away, which is where it matters.
    if (hasCode(error, ALREADY_REGISTERED)) {
      return {
        ok: false,
        message: "That email already has an account. Log in instead.",
      };
    }
    throw error;
  }
}

/** Logs an existing User in. */
export async function logIn(input: unknown): Promise<AuthOutcome> {
  const problem = credentialsProblem(input);
  if (problem) return { ok: false, message: problem };

  const { email, password } = credentials.parse(input);

  try {
    await getAuth().api.signInEmail({ body: { email, password } });
    return { ok: true };
  } catch (error) {
    // One message for a wrong password and for an address with no account.
    // Telling them apart would let anyone ask this application whether a given
    // person has signed up, which is not its business to answer.
    if (hasCode(error, BAD_CREDENTIALS)) {
      return { ok: false, message: "That email or password is not right." };
    }
    throw error;
  }
}

/** Whether better-auth refused for a particular, known reason. */
function hasCode(error: unknown, code: string): boolean {
  return error instanceof APIError && (error.body as { code?: string })?.code === code;
}
