import { describe, expect, it, vi } from "vitest";
import { logIn, signUp } from "@/auth";

/**
 * The regression guard for "logging in returns to the login screen".
 *
 * `logInAction` calls `logIn`, gets `{ ok: true }`, and redirects to
 * `/dashboard` — which redirected straight back because the session cookie
 * better-auth set on its `Response` was never copied onto the response Next
 * sends the browser. `flows.ts` goes through `auth.handler()` for the rate
 * limiter, and the `nextCookies` plugin stands down on router-flagged
 * requests, so nothing was forwarding the cookie.
 *
 * Asserted at the seam the server action uses, with `next/headers` mocked so
 * `cookies().set` can be observed.
 */

type SetCall = { name: string; value: string };

const setCalls: SetCall[] = [];

const cookieStore = {
  set: (name: unknown, value?: unknown) => {
    if (typeof name === "object" && name !== null) {
      const c = name as { name: string; value: string };
      setCalls.push({ name: c.name, value: c.value });
    } else {
      setCalls.push({ name: String(name), value: String(value) });
    }
  },
  get: () => undefined,
  getAll: () => [],
  has: () => false,
  delete: () => {},
};

vi.mock("next/headers.js", () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));

function browser(): Headers {
  return new Headers({ host: "localhost:3000" });
}

const EMAIL = "ada@example.com";
const PASSWORD = "correct-horse-battery-staple";

describe("the session cookie reaches the browser", () => {
  it("sets a session cookie when signing up", async () => {
    setCalls.length = 0;

    expect(await signUp({ email: EMAIL, password: PASSWORD }, browser())).toEqual(
      { ok: true },
    );

    expect(setCalls.map((c) => c.name)).toContain("better-auth.session_token");
  });

  it("sets a session cookie when logging in", async () => {
    await signUp({ email: EMAIL, password: PASSWORD }, browser());
    setCalls.length = 0;

    expect(await logIn({ email: EMAIL, password: PASSWORD }, browser())).toEqual(
      { ok: true },
    );

    expect(setCalls.map((c) => c.name)).toContain("better-auth.session_token");
  });
});
