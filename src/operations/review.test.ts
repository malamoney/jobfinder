import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  addBoard,
  fetchBoard,
  listPostings,
  markViewed,
  readDashboard,
  readPosting,
  saveCriteria,
  setNotes,
  setSaved,
  setStatus,
  type Board,
} from "@/operations";
import { getDb } from "@/db";
import { reviewState, user } from "@/db/schema";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import { geocoderKnows } from "@/test/fixtures/nominatim";
import type { CriteriaInput } from "@/criteria/schema";

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

function statedCriteria(overrides: Partial<CriteriaInput> = {}): CriteriaInput {
  return {
    titles: ["Engineer"],
    keywords: [],
    arrangements: ["full-time", "remote"],
    ...overrides,
  };
}

let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** Fetches the given jobs into the Corpus and returns the first one's id. */
async function corpusHas(
  jobs: Array<Record<string, unknown>>,
): Promise<string> {
  boardReturns("acme", jobs);
  await fetchBoard(acme);
  const [first] = jobs;
  const id = String(first.id);
  const posting = (await listPostings()).find((p) => p.sourceId === id);
  if (!posting) throw new Error(`No Posting "${id}" in the Corpus`);
  return posting.id;
}

describe("a Posting's Status", () => {
  it("starts as new, with no row written", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const details = await readPosting(userId, postingId);

    expect(details?.review).toEqual({
      status: "new",
      notes: "",
      statusChangedAt: null,
      appliedAt: null,
    });
  });

  it("can be set to interested, and read back", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const outcome = await setStatus(userId, postingId, "interested");

    expect(outcome).toEqual({ ok: true });
    const details = await readPosting(userId, postingId);
    expect(details?.review.status).toBe("interested");
    expect(details?.review.statusChangedAt).toBeInstanceOf(Date);
    expect(details?.review.appliedAt).toBeNull();
  });

  it("holds exactly one Status at a time", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setStatus(userId, postingId, "interested");
    await setStatus(userId, postingId, "not_interested");
    await setStatus(userId, postingId, "applied");

    const rows = await getDb()
      .select()
      .from(reviewState)
      .where(eq(reviewState.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("applied");
  });

  it("can be changed after it is set — it is not one-way", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setStatus(userId, postingId, "applied");
    await setStatus(userId, postingId, "interested");

    expect((await readPosting(userId, postingId))?.review.status).toBe(
      "interested",
    );
  });

  it("records the date it became applied", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const before = Date.now();
    await setStatus(userId, postingId, "applied");
    const after = Date.now();

    const appliedAt = (await readPosting(userId, postingId))?.review.appliedAt;
    expect(appliedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(appliedAt?.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it("keeps the applied date after the Status moves away and back", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setStatus(userId, postingId, "applied");
    const first = (await readPosting(userId, postingId))?.review.appliedAt;

    await setStatus(userId, postingId, "interested");
    expect((await readPosting(userId, postingId))?.review.appliedAt).toEqual(
      first,
    );

    await setStatus(userId, postingId, "applied");
    const second = (await readPosting(userId, postingId))?.review.appliedAt;
    expect(second?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? 0);
  });

  it("refuses new as a Status to set", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const outcome = await setStatus(userId, postingId, "new");

    expect(outcome.ok).toBe(false);
    expect((await readPosting(userId, postingId))?.review.status).toBe("new");
  });

  it("refuses a Status that is not one of the four", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    expect((await setStatus(userId, postingId, "archived")).ok).toBe(false);
  });

  it("keeps one User's Status out of another User's", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const ada = await givenAUser("ada@example.com");
    const grace = await givenAUser("grace@example.com");

    await setStatus(ada, postingId, "applied");

    expect((await readPosting(grace, postingId))?.review.status).toBe("new");
  });
});

describe("the Save toggle from a Dashboard card", () => {
  it("saving a Posting sets it to interested", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const outcome = await setSaved(userId, postingId, true);

    expect(outcome).toEqual({ ok: true });
    const details = await readPosting(userId, postingId);
    expect(details?.review.status).toBe("interested");
    expect(details?.review.statusChangedAt).toBeInstanceOf(Date);
  });

  it("un-saving returns the Posting to new", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setSaved(userId, postingId, true);
    await setSaved(userId, postingId, false);

    const details = await readPosting(userId, postingId);
    expect(details?.review.status).toBe("new");
    expect(details?.review.statusChangedAt).toBeNull();
  });

  it("holds one row however many times it is toggled", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setSaved(userId, postingId, true);
    await setSaved(userId, postingId, false);
    await setSaved(userId, postingId, true);

    const rows = await getDb()
      .select()
      .from(reviewState)
      .where(eq(reviewState.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("interested");
  });

  it("shows up on the Dashboard once the User has saved a match", async () => {
    boardReturns("acme", [greenhouseJob({ id: 1, title: "Staff Engineer" })]);
    await fetchBoard(acme);
    const [posting] = await listPostings();
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Engineer"] }));

    await setSaved(userId, posting.id, true);
    let saved = (await readDashboard(userId, "interested")).postings;
    expect(saved.map((p) => p.id)).toEqual([posting.id]);

    await setSaved(userId, posting.id, false);
    saved = (await readDashboard(userId, "interested")).postings;
    expect(saved).toHaveLength(0);
    expect((await readDashboard(userId, "new")).postings.map((p) => p.id)).toEqual(
      [posting.id],
    );
  });

  it("refuses to touch a Posting the User has already applied to", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();
    await setStatus(userId, postingId, "applied");

    const outcome = await setSaved(userId, postingId, false);

    expect(outcome.ok).toBe(false);
    const details = await readPosting(userId, postingId);
    expect(details?.review.status).toBe("applied");
    expect(details?.review.appliedAt).toBeInstanceOf(Date);
  });

  it("refuses a Posting marked not_interested", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();
    await setStatus(userId, postingId, "not_interested");

    expect((await setSaved(userId, postingId, true)).ok).toBe(false);
    expect((await readPosting(userId, postingId))?.review.status).toBe(
      "not_interested",
    );
  });

  it("keeps the applied date intact when it later reads as interested", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();
    await setStatus(userId, postingId, "applied");
    await setStatus(userId, postingId, "interested");

    // The card would show the toggle now (status is interested), but the User
    // has an applied date on this Posting — un-saving must not strand it.
    expect((await setSaved(userId, postingId, false)).ok).toBe(false);
    expect((await readPosting(userId, postingId))?.review.appliedAt).toBeInstanceOf(
      Date,
    );
  });

  it("refuses a non-boolean value", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    expect((await setSaved(userId, postingId, "yes")).ok).toBe(false);
  });

  it("refuses a Save against a missing Posting", async () => {
    const userId = await givenAUser();

    expect(
      (await setSaved(userId, "11111111-1111-1111-1111-111111111111", true)).ok,
    ).toBe(false);
  });
});

describe("Notes on a Posting", () => {
  it("can be written and read back", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setNotes(userId, postingId, "Referred by a friend on the team.");

    expect((await readPosting(userId, postingId))?.review.notes).toBe(
      "Referred by a friend on the team.",
    );
  });

  it("replaces the previous note when edited", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setNotes(userId, postingId, "First pass.");
    await setNotes(userId, postingId, "Changed my mind — worth a look.");

    expect((await readPosting(userId, postingId))?.review.notes).toBe(
      "Changed my mind — worth a look.",
    );
  });

  it("clears the field when given only whitespace", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setNotes(userId, postingId, "Something.");
    await setNotes(userId, postingId, "   \n  ");

    expect((await readPosting(userId, postingId))?.review.notes).toBe("");
  });

  it("rejects a note longer than the cap", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    const outcome = await setNotes(userId, postingId, "x".repeat(10_001));

    expect(outcome.ok).toBe(false);
  });

  it("leaves the Status untouched", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setStatus(userId, postingId, "interested");
    await setNotes(userId, postingId, "A note.");

    expect((await readPosting(userId, postingId))?.review.status).toBe(
      "interested",
    );
  });

  it("does not date a Status change that never happened", async () => {
    const postingId = await corpusHas([greenhouseJob({ id: 1 })]);
    const userId = await givenAUser();

    await setNotes(userId, postingId, "Noted before deciding anything.");

    expect((await readPosting(userId, postingId))?.review).toMatchObject({
      status: "new",
      statusChangedAt: null,
    });
  });
});

describe("Review State against what a Source does", () => {
  it("survives a re-Fetch that rewrites the Posting", async () => {
    const postingId = await corpusHas([
      greenhouseJob({ id: 1, content: "&lt;p&gt;The original.&lt;/p&gt;" }),
    ]);
    const userId = await givenAUser();
    await setStatus(userId, postingId, "applied");
    await setNotes(userId, postingId, "Applied through a referral.");

    boardReturns("acme", [
      greenhouseJob({ id: 1, content: "&lt;p&gt;Now with on-call.&lt;/p&gt;" }),
    ]);
    await fetchBoard(acme);

    const details = await readPosting(userId, postingId);
    expect(details?.description).toBe("<p>Now with on-call.</p>");
    expect(details?.review.status).toBe("applied");
    expect(details?.review.notes).toBe("Applied through a referral.");
  });

  it("survives the Posting being marked Expired", async () => {
    const postingId = await corpusHas([
      greenhouseJob({ id: 1 }),
      greenhouseJob({ id: 2 }),
    ]);
    const userId = await givenAUser();
    await setStatus(userId, postingId, "applied");
    await setNotes(userId, postingId, "Waiting to hear back.");

    // Two successful Fetches without Posting 1 mark it Expired (#7).
    boardReturns("acme", [greenhouseJob({ id: 2 })]);
    await fetchBoard(acme);
    boardReturns("acme", [greenhouseJob({ id: 2 })]);
    await fetchBoard(acme);

    const details = await readPosting(userId, postingId);
    expect(details?.expired).toBe(true);
    expect(details?.review.status).toBe("applied");
    expect(details?.review.notes).toBe("Waiting to hear back.");
  });
});

describe("an unresolved location on the Posting page", () => {
  it("flags a Posting whose location could not be geocoded", async () => {
    const postingId = await corpusHas([
      greenhouseJob({
        id: 1,
        location: { name: "Undisclosed location, USA" },
        content: "&lt;p&gt;This is an onsite role.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();
    // A match run over an onsite Criteria geocodes the location; it resolves to
    // nothing and is cached as unresolved.
    geocoderKnows({
      "boston, ma": { latitude: 42.3601, longitude: -71.0589 },
    });
    await saveCriteria(userId, {
      titles: ["Staff Engineer"],
      keywords: [],
      arrangements: ["full-time", "onsite"],
      homeLocation: "Boston, MA",
      radiusMiles: 25,
    });

    expect((await readPosting(userId, postingId))?.unresolvedLocation).toBe(true);
  });

  // A Posting the Source gave no location for is dropped at ingestion now — a
  // null location classifies as `unknown`, and the Corpus keeps only `us`
  // (ADR 0010) — so there is no such Posting to flag or not flag.
});

describe("reading a Posting that is not there", () => {
  it("is null for an unknown id", async () => {
    const userId = await givenAUser();

    expect(
      await readPosting(userId, "11111111-1111-1111-1111-111111111111"),
    ).toBeNull();
  });

  it("is null for an id that is not a UUID", async () => {
    const userId = await givenAUser();

    expect(await readPosting(userId, "not-an-id")).toBeNull();
  });

  it("refuses a Status set against a missing Posting", async () => {
    const userId = await givenAUser();

    const outcome = await setStatus(
      userId,
      "11111111-1111-1111-1111-111111111111",
      "interested",
    );

    expect(outcome.ok).toBe(false);
  });
});

describe("filtering the Dashboard by Status", () => {
  /** A User with three matched Postings, one per Status they will be set to. */
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
    await saveCriteria(userId, statedCriteria({ titles: ["Engineer"] }));

    const ids = {
      kept: idFor("1"),
      dismissed: idFor("2"),
      applied: idFor("3"),
    };
    await setStatus(userId, ids.dismissed, "not_interested");
    await setStatus(userId, ids.applied, "applied");
    return { userId, ids };
  }

  it("hides not_interested Postings by default", async () => {
    const { userId, ids } = await threeMatched();

    const shown = (await readDashboard(userId)).postings.map((p) => p.id);

    expect(shown).toContain(ids.kept);
    expect(shown).toContain(ids.applied);
    expect(shown).not.toContain(ids.dismissed);
  });

  it("shows only the requested Status when one is given", async () => {
    const { userId, ids } = await threeMatched();

    const applied = (await readDashboard(userId, "applied")).postings;
    expect(applied.map((p) => p.id)).toEqual([ids.applied]);

    const dismissed = (await readDashboard(userId, "not_interested")).postings;
    expect(dismissed.map((p) => p.id)).toEqual([ids.dismissed]);

    const fresh = (await readDashboard(userId, "new")).postings;
    expect(fresh.map((p) => p.id)).toEqual([ids.kept]);
  });

  it("shows every matched Posting under \"all\"", async () => {
    const { userId } = await threeMatched();

    expect((await readDashboard(userId, "all")).postings).toHaveLength(3);
  });

  it("counts only live, still-new Postings as unreviewed, whatever the filter", async () => {
    const { userId } = await threeMatched();

    for (const filter of [undefined, "all", "applied", "new"] as const) {
      expect((await readDashboard(userId, filter)).unreviewedCount).toBe(1);
    }
  });

  it("carries each Posting's Status and applied date onto the Dashboard", async () => {
    const { userId, ids } = await threeMatched();

    const applied = (await readDashboard(userId, "applied")).postings[0];
    expect(applied.id).toBe(ids.applied);
    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBeInstanceOf(Date);
  });
});

describe("marking a Posting viewed", () => {
  /** A User with one matched Posting; returns both ids. */
  async function oneMatched(): Promise<{ userId: string; postingId: string }> {
    boardReturns("acme", [greenhouseJob({ id: 1, title: "Staff Engineer" })]);
    await fetchBoard(acme);
    const [posting] = await listPostings();
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Engineer"] }));
    return { userId, postingId: posting.id };
  }

  it("a matched Posting is not viewed until it has been opened", async () => {
    const { userId } = await oneMatched();

    expect((await readDashboard(userId)).postings[0].viewed).toBe(false);
  });

  it("shows as viewed on the Dashboard once opened", async () => {
    const { userId, postingId } = await oneMatched();

    await markViewed(userId, postingId);

    expect((await readDashboard(userId)).postings[0].viewed).toBe(true);
  });

  it("does not touch the Status — viewing is not reviewing", async () => {
    const { userId, postingId } = await oneMatched();

    await markViewed(userId, postingId);

    const card = (await readDashboard(userId)).postings[0];
    expect(card.status).toBe("new");
    expect((await readDashboard(userId)).unreviewedCount).toBe(1);
    expect((await readPosting(userId, postingId))?.review.statusChangedAt).toBeNull();
  });

  it("keeps the first-view time when opened again", async () => {
    const { userId, postingId } = await oneMatched();

    await markViewed(userId, postingId);
    const [first] = await getDb()
      .select({ viewedAt: reviewState.viewedAt })
      .from(reviewState)
      .where(eq(reviewState.userId, userId));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await markViewed(userId, postingId);
    const [second] = await getDb()
      .select({ viewedAt: reviewState.viewedAt })
      .from(reviewState)
      .where(eq(reviewState.userId, userId));

    expect(second.viewedAt).toEqual(first.viewedAt);
  });

  it("records the view alongside a Status the User had already set", async () => {
    const { userId, postingId } = await oneMatched();
    await setStatus(userId, postingId, "interested");

    await markViewed(userId, postingId);

    const card = (await readDashboard(userId)).postings[0];
    expect(card.status).toBe("interested");
    expect(card.viewed).toBe(true);
  });

  it("is a no-op for a Posting that is not in the Corpus", async () => {
    const userId = await givenAUser();

    await expect(
      markViewed(userId, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });
});
