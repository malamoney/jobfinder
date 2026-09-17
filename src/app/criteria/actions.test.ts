import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { matchedPostingsUserTag } from "../dashboard/matched-postings-cache";
import { saveCriteriaAction } from "./actions";

/**
 * The Criteria action's invalidation of the matched Postings cache (#155):
 * a successful save must `updateTag` the User's own tag — the read-your-own-
 * writes primitive — and a refused save, or nobody signed in, must not.
 *
 * `next/cache` is mocked, as it must be here: `updateTag` throws outside a
 * Server Action's real request scope. `next/headers` is mocked the way
 * `cookie-propagation.test.ts` mocks it — a capturing cookie store standing in
 * for the browser, fed back through `headers()` — so `saveCriteriaAction`
 * runs its own `currentUser` check against a genuine signed-up User rather
 * than a stubbed one.
 */

const { updateTag } = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag }));

const { setCalls, headerState } = vi.hoisted(() => ({
  setCalls: [] as { name: string; value: string }[],
  headerState: { cookie: "" },
}));

vi.mock("next/headers", () => {
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
  return {
    cookies: async () => cookieStore,
    headers: async () =>
      new Headers(headerState.cookie ? { cookie: headerState.cookie } : {}),
  };
});

const PASSWORD = "correct-horse-battery-staple";
const VALID_INPUT = {
  titles: ["Engineer"],
  keywords: [],
  arrangements: ["full-time", "remote"],
};

/** Signs a fresh User up and returns the `Cookie` header their session sets. */
async function signedInCookie(email: string): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not sign up: ${outcome.message}`);
  return setCalls.map((c) => `${c.name}=${c.value}`).join("; ");
}

beforeEach(() => {
  updateTag.mockClear();
  setCalls.length = 0;
  headerState.cookie = "";
});

describe("saveCriteriaAction", () => {
  it("updates the signed-in User's own matched-Postings tag on a successful save", async () => {
    headerState.cookie = await signedInCookie("ada@example.com");
    const [row] = await getDb()
      .select()
      .from(user)
      .where(eq(user.email, "ada@example.com"));

    const outcome = await saveCriteriaAction(null, VALID_INPUT);

    expect(outcome.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith(matchedPostingsUserTag(row.id));
  });

  it("does not update any tag when the save is refused", async () => {
    headerState.cookie = await signedInCookie("grace@example.com");

    const outcome = await saveCriteriaAction(null, {
      titles: [],
      keywords: [],
      arrangements: ["full-time"],
    });

    expect(outcome.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("does not update any tag when nobody is signed in", async () => {
    const outcome = await saveCriteriaAction(null, VALID_INPUT);

    expect(outcome.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
