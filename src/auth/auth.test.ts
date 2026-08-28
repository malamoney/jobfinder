import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth, logIn, signUp } from "@/auth";
import { getDb } from "@/db";
import { account, session, user } from "@/db/schema";

/** Long enough to pass, and the same one throughout so a leak is findable. */
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "ada@example.com";

/** Signs up the User the logging-in tests need. */
async function existingUser(): Promise<void> {
  const outcome = await signUp({ email: EMAIL, password: PASSWORD });
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);
}

/**
 * Signs in and hands back the cookie a browser would keep, plus the raw
 * `Set-Cookie` so its lifetime can be inspected.
 */
async function signInForCookie(password = PASSWORD) {
  const response = await getAuth().api.signInEmail({
    body: { email: EMAIL, password },
    asResponse: true,
  });
  const setCookie = response.headers.get("set-cookie") ?? "";
  const pair = setCookie.split(";")[0];

  // The cookie carries `<token>.<signature>`; the token is what the session
  // row is keyed by.
  const token = decodeURIComponent(pair.slice(pair.indexOf("=") + 1)).split(
    ".",
  )[0];

  return { setCookie, token, headers: new Headers({ cookie: pair }) };
}

describe("signing up", () => {
  it("creates an account the User can be found by", async () => {
    expect(await signUp({ email: EMAIL, password: PASSWORD })).toEqual({
      ok: true,
    });

    const [created] = await getDb().select().from(user);
    expect(created.email).toBe(EMAIL);
  });

  // The one thing this application must never do. Asserted against every
  // column of every row rather than the one we expect to hold it, so a future
  // field that starts carrying the plaintext is caught too.
  it("never lets the password itself reach the database", async () => {
    await signUp({ email: EMAIL, password: PASSWORD });

    const rows = [
      ...(await getDb().select().from(user)),
      ...(await getDb().select().from(account)),
    ];
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);

    // And something *was* stored, so the assertion above is not passing
    // merely because nothing was written at all.
    const [credentials] = await getDb().select().from(account);
    expect(credentials.password).toEqual(expect.any(String));
  });

  it("refuses a second account on the same email, and says which problem it is", async () => {
    await existingUser();

    const outcome = await signUp({ email: EMAIL, password: PASSWORD });

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringContaining("already"),
    });
    expect(await getDb().select().from(user)).toHaveLength(1);
  });

  // Caught by the shared schema before better-auth is reached, so the message
  // is the one the form shows rather than a library's phrasing.
  it.each([
    ["a password too short to be one", { email: EMAIL, password: "short" }, /12 characters/],
    ["something that is not an email", { email: "ada", password: PASSWORD }, /email address/],
  ])("refuses %s without touching the database", async (_case, input, expected) => {
    const outcome = await signUp(input);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(expected);
    expect(await getDb().select().from(user)).toEqual([]);
  });

  // Strict schemas: nothing legitimate sends fields the contract does not
  // name, so anything that does is a stale client or someone probing.
  it("refuses a field it does not recognise", async () => {
    const outcome = await signUp({
      email: EMAIL,
      password: PASSWORD,
      role: "admin",
    });

    expect(outcome.ok).toBe(false);
    expect(await getDb().select().from(user)).toEqual([]);
  });
});

describe("logging in", () => {
  it("accepts the password the account was made with", async () => {
    await existingUser();

    expect(await logIn({ email: EMAIL, password: PASSWORD })).toEqual({
      ok: true,
    });
  });

  // Deliberately one message for both. Saying which half was wrong would let
  // anyone check whether an address has an account here, which is not a
  // question this application should answer.
  it.each([
    ["the wrong password", { email: EMAIL, password: "wrong-password-entirely" }],
    ["an email with no account", { email: "nobody@example.com", password: PASSWORD }],
  ])("refuses %s without saying which half was wrong", async (_case, input) => {
    await existingUser();

    const outcome = await logIn(input);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(/email or password/i);
  });
});

describe("staying logged in", () => {
  // The acceptance criterion in the only form it can be checked from here: a
  // cookie with a lifetime outlives the browser, a cookie without one does
  // not survive the window closing.
  it("keeps the session across closing and reopening the browser", async () => {
    await existingUser();

    const { setCookie } = await signInForCookie();

    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    expect(maxAge).toBeGreaterThan(7 * 24 * 60 * 60);
  });

  it("knows who a session belongs to", async () => {
    await existingUser();
    const { headers } = await signInForCookie();

    const current = await getAuth().api.getSession({ headers });

    expect(current?.user.email).toBe(EMAIL);
  });

  it("knows nobody without one", async () => {
    await existingUser();

    const current = await getAuth().api.getSession({ headers: new Headers() });

    expect(current).toBeNull();
  });

  // Ended at the server, not merely forgotten by the browser. A logout that
  // only cleared the cookie would leave a token that still works to anyone who
  // had already copied it.
  it("destroys the session on logging out, rather than just dropping the cookie", async () => {
    await existingUser();
    const { headers, token } = await signInForCookie();
    expect(
      await getDb().select().from(session).where(eq(session.token, token)),
    ).toHaveLength(1);

    await getAuth().api.signOut({ headers });

    expect(await getAuth().api.getSession({ headers })).toBeNull();
    expect(
      await getDb().select().from(session).where(eq(session.token, token)),
    ).toEqual([]);
  });
});
