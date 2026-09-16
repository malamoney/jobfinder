import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import {
  addBoard,
  fetchBoard,
  listPostings,
  overlayReviewState,
  readDashboard,
  readMatchedPostings,
  saveCriteria,
  setStatus,
  type Board,
} from "@/operations";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import { dashboardMatchQuery } from "./dashboard";

/**
 * The cost regression for #138: the Dashboard read must not carry the
 * description text. It is 95% of a Posting row, the card renders none of it, and
 * the only consumer — `chooseRepresentative` — needs a length, not the text.
 *
 * Asserted against the generated SQL rather than the rendered cards: a card
 * test would pass just as well with the column selected and then ignored. The
 * property is the point, so the property is what is pinned.
 */
describe("the Dashboard Posting read", () => {
  const { sql: text } = dashboardMatchQuery(
    getDb(),
    "00000000-0000-0000-0000-000000000000",
  ).toSQL();

  it("does not select the description column as text", () => {
    // The only place the column name may appear is as the argument to
    // `length(...)`. With those calls removed, the text of the query must not
    // name `description` at all — anywhere else is the whole column coming back
    // over the wire.
    const withoutLengthCalls = text.replace(/length\([^)]*\)/gi, "");
    expect(withoutLengthCalls).not.toMatch(/description/i);
  });

  it("asks the database for the description's length instead", () => {
    expect(text.toLowerCase()).toContain('length("postings"."description")');
  });

  it("still selects every column the card, its order, and its flags need", () => {
    for (const column of [
      "id",
      "company",
      "title",
      "posted_at",
      "apply_url",
      "location",
      "arrangements",
      "salary_min",
      "salary_max",
      "salary_period",
      "dedup_key",
      "first_seen_at",
      "source",
      "source_id",
      "absent_fetches",
      "expires_at",
    ]) {
      expect(text).toContain(`"${column}"`);
    }
  });
});

const PASSWORD = "correct-horse-battery-staple";

async function givenAUser(email = "ada@example.com"): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);

  const [row] = await getDb().select().from(user).where(eq(user.email, email));
  return row.id;
}

let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/**
 * A User with three matched openings, one dismissed and one applied to —
 * enough Review State that the overlay has something to overlay.
 */
async function threeMatched(): Promise<{
  userId: string;
  ids: Record<"kept" | "dismissed" | "applied", string>;
}> {
  boardReturns("acme", [
    greenhouseJob({ id: 1, title: "Staff Engineer" }),
    greenhouseJob({ id: 2, title: "Platform Engineer" }),
    greenhouseJob({ id: 3, title: "Data Engineer" }),
  ]);
  await fetchBoard(acme);
  const corpus = await listPostings();
  const idFor = (sourceId: string) =>
    corpus.find((p) => p.sourceId === sourceId)!.id;

  const userId = await givenAUser();
  await saveCriteria(userId, {
    titles: ["Engineer"],
    keywords: [],
    arrangements: ["full-time", "remote"],
  });

  const ids = {
    kept: idFor("1"),
    dismissed: idFor("2"),
    applied: idFor("3"),
  };
  await setStatus(userId, ids.dismissed, "not_interested");
  await setStatus(userId, ids.applied, "applied");
  return { userId, ids };
}

/**
 * The split of #154: the half of the Dashboard read that changes only at a
 * match rebuild or a Criteria save, apart from the half the User's clicks and
 * the clock change. The first is what #155 will store, so it must carry
 * nothing a click decides and survive being stored as JSON.
 */
describe("the matched Postings read", () => {
  it("carries facts only — nothing a click or the clock decides", async () => {
    const { userId, ids } = await threeMatched();

    const matched = await readMatchedPostings(userId);

    expect(matched.map((opening) => opening.id).sort()).toEqual(
      Object.values(ids).sort(),
    );
    for (const opening of matched) {
      expect(opening).not.toHaveProperty("status");
      expect(opening).not.toHaveProperty("appliedAt");
      expect(opening).not.toHaveProperty("viewed");
      expect(opening).not.toHaveProperty("expired");
    }
  });

  it("is stable through a JSON round-trip", async () => {
    const { userId } = await threeMatched();

    const matched = await readMatchedPostings(userId);

    expect(JSON.parse(JSON.stringify(matched))).toEqual(matched);
  });

  it("yields the same Dashboard whether the overlay reads a live copy or a stored one", async () => {
    const { userId } = await threeMatched();
    const live = await readMatchedPostings(userId);
    const stored = JSON.parse(JSON.stringify(live));

    for (const filter of [undefined, "all", "applied", "new"] as const) {
      const fromLive = await overlayReviewState(live, userId, filter);
      const fromStored = await overlayReviewState(stored, userId, filter);

      expect(fromStored).toEqual(fromLive);
      expect(fromStored).toEqual(await readDashboard(userId, filter));
    }
  });
});

/**
 * The other half: everything the User's clicks or the clock decide, derived
 * live over a list handed in. Driven with a list the test edits by hand —
 * one opening gone from its Board, one past its close date, one collected
 * before today — so the derived flags and counts have a known answer.
 */
describe("the Review State overlay", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function fixedList() {
    const { userId, ids } = await threeMatched();
    const matched = (await readMatchedPostings(userId)).map((opening) => {
      if (opening.id === ids.kept) {
        // Missing from two Fetches in a row: gone from its Board.
        return { ...opening, absentFetches: 2 };
      }
      if (opening.id === ids.applied) {
        // A close date the feed published, now behind us; also collected
        // before today.
        const yesterday = new Date(Date.now() - DAY_MS).toISOString();
        return {
          ...opening,
          expiresAt: yesterday,
          earliestFirstSeenAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
        };
      }
      return opening;
    });
    return { userId, ids, matched };
  }

  it("decides Expired from the facts, by absence or by close date", async () => {
    const { userId, ids, matched } = await fixedList();

    const { postings } = await overlayReviewState(matched, userId, "all");

    const expiredBy = new Map(postings.map((p) => [p.id, p.expired]));
    expect(expiredBy.get(ids.kept)).toBe(true);
    expect(expiredBy.get(ids.applied)).toBe(true);
    expect(expiredBy.get(ids.dismissed)).toBe(false);
  });

  it("counts from the marks and the clock, not the filter", async () => {
    const { userId, matched } = await fixedList();

    for (const filter of [undefined, "all", "applied", "new"] as const) {
      const dashboard = await overlayReviewState(matched, userId, filter);

      expect(dashboard).toMatchObject({
        matchedCount: 3,
        // The one still-new opening is Expired, so nothing is worth a look.
        unreviewedCount: 0,
        interestedCount: 0,
        notInterestedCount: 1,
        appliedCount: 1,
        // The dismissed one is the only live opening collected today.
        newTodayCount: 1,
      });
    }
  });

  it("shows what each filter value asks for", async () => {
    const { userId, ids, matched } = await fixedList();
    const shown = async (filter?: Parameters<typeof overlayReviewState>[2]) =>
      (await overlayReviewState(matched, userId, filter)).postings
        .map((p) => p.id)
        .sort();

    expect(await shown()).toEqual([ids.kept, ids.applied].sort());
    expect(await shown("all")).toEqual(Object.values(ids).sort());
    expect(await shown("new")).toEqual([ids.kept]);
    expect(await shown("interested")).toEqual([]);
    expect(await shown("not_interested")).toEqual([ids.dismissed]);
    expect(await shown("applied")).toEqual([ids.applied]);
  });
});
