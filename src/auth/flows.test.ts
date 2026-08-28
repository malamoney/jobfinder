import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { currentUser, getAuth, logIn, logOut, signUp } from "@/auth";
import { getDb } from "@/db";
import { account, session, user } from "@/db/schema";

/** Long enough to pass, and the same one throughout so a leak is findable. */
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "ada@example.com";

/** What a browser would send. The host is what the endpoint URL is built from. */
function browser(): Headers {
  return new Headers({ host: "localhost:3000" });
}

/** Signs up the User that the logging-in tests need. */
async function givenAnAccountExists(): Promise<void> {
  const outcome = await signUp({ email: EMAIL, password: PASSWORD }, browser());
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);
}

/**
 * Logs in through the same router the form goes through, and hands back the
 * cookie a browser would keep plus the raw `Set-Cookie` so its lifetime can be
 * inspected.
 */
async function logInForCookie(password = PASSWORD) {
  const response = await getAuth().handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password }),
    }),
  );

  const setCookie = response.headers.get("set-cookie") ?? "";
  const pair = setCookie.split(";")[0];
  // The cookie carries `<token>.<signature>`; the token keys the session row.
  const token = decodeURIComponent(pair.slice(pair.indexOf("=") + 1)).split(
    ".",
  )[0];

  return { setCookie, token, headers: new Headers({ cookie: pair }) };
}

describe("signing up", () => {
  it("creates an account the User can be found by", async () => {
    expect(await signUp({ email: EMAIL, password: PASSWORD }, browser())).toEqual(
      { ok: true },
    );

    const [created] = await getDb().select().from(user);
    expect(created.email).toBe(EMAIL);
  });

  // The one thing this application must never do. Asserted against every
  // column of every row rather than the one we expect to hold it, so a future
  // field that starts carrying the plaintext is caught too.
  it("never lets the password itself reach the database", async () => {
    await givenAnAccountExists();

    const rows = [
      ...(await getDb().select().from(user)),
      ...(await getDb().select().from(account)),
    ];
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);

    // And something *was* stored, so the assertion above is not passing
    // merely because nothing was written at all.
    const [stored] = await getDb().select().from(account);
    expect(stored.password).toEqual(expect.any(String));
  });

  it("refuses a second account on the same email, and says which problem it is", async () => {
    await givenAnAccountExists();

    const outcome = await signUp({ email: EMAIL, password: PASSWORD }, browser());

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
    const outcome = await signUp(input, browser());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(expected);
    expect(await getDb().select().from(user)).toEqual([]);
  });

  // A pasted address arrives with the spaces that came with it.
  it("accepts an email with whitespace around it", async () => {
    const outcome = await signUp(
      { email: `  ${EMAIL} `, password: PASSWORD },
      browser(),
    );

    expect(outcome).toEqual({ ok: true });
    const [created] = await getDb().select().from(user);
    expect(created.email).toBe(EMAIL);
  });

  // Strict schemas: nothing legitimate sends fields the contract does not
  // name, so anything that does is a stale client or someone probing.
  it("refuses a field it does not recognise", async () => {
    const outcome = await signUp(
      { email: EMAIL, password: PASSWORD, role: "admin" },
      browser(),
    );

    expect(outcome.ok).toBe(false);
    expect(await getDb().select().from(user)).toEqual([]);
  });
});

describe("logging in", () => {
  it("accepts the password the account was made with", async () => {
    await givenAnAccountExists();

    expect(await logIn({ email: EMAIL, password: PASSWORD }, browser())).toEqual(
      { ok: true },
    );
  });

  // Deliberately one message for both. Saying which half was wrong would let
  // anyone check whether an address has an account here, which is not a
  // question this application should answer.
  it.each([
    ["the wrong password", { email: EMAIL, password: "wrong-password-entirely" }],
    ["an email with no account", { email: "nobody@example.com", password: PASSWORD }],
  ])("refuses %s without saying which half was wrong", async (_case, input) => {
    await givenAnAccountExists();

    const outcome = await logIn(input, browser());

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(/email or password/i);
  });

  /**
   * The regression guard for a real hole: better-auth's limiter runs in its
   * router, so calling the endpoint function directly — which is the obvious
   * way to write this — left the login form accepting unlimited guesses while
   * the HTTP route nobody used was the only protected one.
   */
  it("stops answering after a run of wrong passwords", async () => {
    await givenAnAccountExists();

    const messages: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const outcome = await logIn(
        { email: EMAIL, password: `wrong-password-${attempt}` },
        browser(),
      );
      if (!outcome.ok) messages.push(outcome.message);
    }

    expect(messages.some((message) => /too many/i.test(message))).toBe(true);
  });
});

describe("staying logged in", () => {
  // The acceptance criterion in the only form it can be checked from here: a
  // cookie with a lifetime outlives the browser, a cookie without one does
  // not survive the window closing.
  it("keeps the session across closing and reopening the browser", async () => {
    await givenAnAccountExists();

    const { setCookie } = await logInForCookie();

    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    expect(maxAge).toBeGreaterThan(7 * 24 * 60 * 60);
  });

  it("knows who a session belongs to", async () => {
    await givenAnAccountExists();
    const { headers } = await logInForCookie();

    expect((await currentUser(headers))?.email).toBe(EMAIL);
  });

  it("knows nobody without one", async () => {
    await givenAnAccountExists();

    expect(await currentUser(new Headers())).toBeNull();
  });

  // Ended at the server, not merely forgotten by the browser. A logout that
  // only cleared the cookie would leave a token that still works to anyone who
  // had already copied it.
  it("destroys the session on logging out, rather than just dropping the cookie", async () => {
    await givenAnAccountExists();
    const { headers, token } = await logInForCookie();
    expect(
      await getDb().select().from(session).where(eq(session.token, token)),
    ).toHaveLength(1);

    await logOut(headers);

    expect(await currentUser(headers)).toBeNull();
    expect(
      await getDb().select().from(session).where(eq(session.token, token)),
    ).toEqual([]);
  });
});
