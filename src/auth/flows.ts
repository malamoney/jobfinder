import { cookies } from "next/headers";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { getAuth } from "./instance";
import {
  credentials,
  credentialsProblem,
  type AuthOutcome,
  type Credentials,
} from "./credentials";

/**
 * Signing up, logging in, logging out, and asking who is signed in.
 *
 * The seam the application uses, so nothing outside this module reaches into
 * better-auth: a page asks `currentUser()`, a form posts to `signUp` or
 * `logIn`, and the tests assert against these rather than against the library.
 *
 * The three credential flows answer with an `AuthOutcome` rather than throwing.
 * A failed login is an ordinary outcome of using the application, not an
 * exception, and the person who typed the password needs a sentence rather
 * than an error boundary.
 */

/**
 * better-auth's codes for the failures a person can actually cause.
 *
 * Matched on the code rather than the message, so a reworded library string
 * cannot turn a specific explanation into the generic fallback.
 */
const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "That email already has an account. Log in instead.",
  // One message for a wrong password and for an address with no account.
  // Telling them apart would let anyone ask this application whether a given
  // person has signed up, which is not its business to answer.
  INVALID_EMAIL_OR_PASSWORD: "That email or password is not right.",
  PASSWORD_TOO_LONG: "That password is too long.",
};

/**
 * What a caller sees when better-auth refuses for a reason of its own.
 *
 * Vague, but it is a sentence in a form rather than a crash: an unmapped
 * refusal used to be rethrown, and an uncaught throw in a server action
 * reaches the error boundary instead of the field it belongs under.
 */
const UNEXPLAINED = "That did not work. Try again in a moment.";

/** Rate limiting answers with a status rather than a code. */
const TOO_MANY = "Too many attempts. Wait a moment and try again.";

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
export async function signUp(
  input: unknown,
  requestHeaders: Headers,
): Promise<AuthOutcome> {
  const checked = check(input);
  if (!checked.ok) return checked;

  const { email, password } = checked.value;
  return post("/sign-up/email", requestHeaders, {
    email,
    password,
    name: nameFrom(email),
  });
}

/** Logs an existing User in. */
export async function logIn(
  input: unknown,
  requestHeaders: Headers,
): Promise<AuthOutcome> {
  const checked = check(input);
  if (!checked.ok) return checked;

  return post("/sign-in/email", requestHeaders, checked.value);
}

/** Ends the current session, at the server rather than only in the browser. */
export async function logOut(requestHeaders: Headers): Promise<void> {
  await getAuth().api.signOut({ headers: requestHeaders });
}

/** Who is signed in, or nobody. */
export async function currentUser(requestHeaders: Headers) {
  const current = await getAuth().api.getSession({ headers: requestHeaders });
  return current?.user ?? null;
}

/** Validates once, and hands back the parsed values rather than re-parsing. */
function check(
  input: unknown,
): { ok: true; value: Credentials } | { ok: false; message: string } {
  const parsed = credentials.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };

  return { ok: false, message: credentialsProblem(input) ?? UNEXPLAINED };
}

/**
 * Posts to one of better-auth's own endpoints, through its router.
 *
 * Not `auth.api.signInEmail(...)`, which looks equivalent and is not: the
 * rate limiter runs in the router's `onRequest`, so calling the endpoint
 * function directly skips it. That left the login form — the one path an
 * attacker would actually use — accepting unlimited password guesses, while
 * the mounted route nobody used was the only one protected.
 *
 * Going through the router also means the form and the HTTP endpoint behave
 * identically, because they are now the same code path.
 */
async function post(
  path: string,
  requestHeaders: Headers,
  body: Record<string, string>,
): Promise<AuthOutcome> {
  const request = new Request(endpointUrl(path, requestHeaders), {
    method: "POST",
    // The caller's headers carry the address the rate limiter counts against,
    // and the origin Next's own checks were performed on.
    headers: withJson(requestHeaders),
    body: JSON.stringify(body),
  });

  const response = await getAuth().handler(request);
  await forwardSetCookies(response);
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, message: TOO_MANY };

  const refusal = (await response.json().catch(() => ({}))) as {
    code?: string;
  };
  return {
    ok: false,
    message: (refusal.code && MESSAGES[refusal.code]) || UNEXPLAINED,
  };
}

function withJson(requestHeaders: Headers): Headers {
  const forwarded = new Headers(requestHeaders);
  forwarded.set("content-type", "application/json");
  return forwarded;
}

/**
 * Copies the session cookie off better-auth's response onto the one Next is
 * building for this server action.
 *
 * The `nextCookies` plugin would normally do this, but it stands down when a
 * request comes through `auth.handler()` (it checks `_flag === "router"`),
 * which is exactly how `post` calls better-auth — for the rate limiter. So a
 * sign-in succeeded, its `Set-Cookie` sat unread on a `Response` we threw
 * away, and the browser was redirected to `/dashboard` with no session,
 * landing straight back on `/login`.
 *
 * Wrapped in a try because `cookies()` throws outside a request scope, which
 * is where the flow tests call `signUp` and `logIn` from.
 */
async function forwardSetCookies(response: Response): Promise<void> {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return;

  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return;
  }

  for (const [name, attributes] of parseSetCookieHeader(setCookie)) {
    if (name) store.set(name, attributes.value, toCookieOptions(attributes));
  }
}

/**
 * Where better-auth is mounted, as an absolute URL.
 *
 * Taken from the request when nothing is configured, so local development and
 * preview deployments work without being told their own address; `#20` pins
 * `BETTER_AUTH_URL` in production, where trusting the `Host` header is not
 * something to do by choice.
 */
function endpointUrl(path: string, requestHeaders: Headers): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) return new URL(`/api/auth${path}`, configured).toString();

  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}/api/auth${path}`;
}
