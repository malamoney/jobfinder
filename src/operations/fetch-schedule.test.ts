import { desc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  addBoard,
  drainAndRematch,
  drainFetchQueue,
  FETCH_COOLDOWN_MS,
  listPostings,
  readDashboard,
  readLatestFetchRun,
  requestFetch,
  runFetchBatch,
  saveCriteria,
  startFetchRun,
} from "@/operations";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { fetchRuns, postings, user } from "@/db/schema";
import {
  boardRefuses,
  boardReturns,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";

/** An enabled Greenhouse Board that returns one Posting when fetched. */
async function workingBoard(slug: string, id: number): Promise<void> {
  await addBoard({ source: "greenhouse", slug });
  boardReturns(slug, [greenhouseJob({ id, company_name: slug })]);
}

/** An enabled Greenhouse Board that answers 404. */
async function deadBoard(slug: string): Promise<void> {
  await addBoard({ source: "greenhouse", slug });
  boardRefuses(slug);
}

const PASSWORD = "correct-horse-battery-staple";

/** Signs up a User and returns their id. */
async function givenAUser(email = "ada@example.com"): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);
  const [row] = await getDb().select().from(user).where(eq(user.email, email));
  return row.id;
}

/** Backdates the most recent run so the cooldown has elapsed. */
async function ageLatestRun(byMs: number): Promise<void> {
  const db = getDb();
  const [latest] = await db
    .select({ id: fetchRuns.id })
    .from(fetchRuns)
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1);
  await db
    .update(fetchRuns)
    .set({ startedAt: sql`now() - (${byMs / 1000}::double precision * interval '1 second')` })
    .where(eq(fetchRuns.id, latest.id));
}

describe("requesting an on-demand Fetch", () => {
  it("starts a run when none has ever run", async () => {
    await workingBoard("acme", 1);

    const outcome = await requestFetch();

    expect(outcome.ok).toBe(true);
    await drainFetchQueue();
    expect((await readLatestFetchRun())?.boardCount).toBe(1);
  });

  it("refuses a second Fetch inside the cooldown, with a message and a time", async () => {
    await workingBoard("acme", 1);
    const first = await requestFetch();
    expect(first.ok).toBe(true);

    const second = await requestFetch();

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected a refusal");
    expect(second.message).toMatch(/less than an hour ago/i);
    expect(second.retryAfter).toBeInstanceOf(Date);
    expect(second.retryAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps two concurrent requests from both starting a run", async () => {
    await workingBoard("acme", 1);

    const [a, b] = await Promise.all([requestFetch(), requestFetch()]);

    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await getDb().select().from(fetchRuns)).toHaveLength(1);
  });

  it("allows another Fetch once the cooldown has elapsed", async () => {
    await workingBoard("acme", 1);
    await requestFetch();
    await ageLatestRun(FETCH_COOLDOWN_MS + 60_000);

    const again = await requestFetch();

    expect(again.ok).toBe(true);
    const runs = await getDb().select().from(fetchRuns);
    expect(runs).toHaveLength(2);
  });
});

describe("draining the queue", () => {
  it("works every queued Board to completion in one call", async () => {
    await workingBoard("acme", 1);
    await workingBoard("globex", 2);
    await workingBoard("initech", 3);
    await startFetchRun();

    const result = await drainFetchQueue({ batch: { batchSize: 2 } });

    expect(result.remaining).toBe(0);
    expect(result.succeeded).toBe(3);
    expect(result.batches).toBeGreaterThan(1);
    expect((await listPostings()).map((p) => p.company).sort()).toEqual([
      "acme",
      "globex",
      "initech",
    ]);
    expect((await readLatestFetchRun())?.running).toBe(false);
  });

  it("stops at its budget and leaves the rest queued", async () => {
    await workingBoard("acme", 1);
    await workingBoard("globex", 2);
    await startFetchRun();

    const result = await drainFetchQueue({
      budgetMs: 0,
      batch: { batchSize: 1 },
    });

    expect(result.batches).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.remaining).toBe(1);
  });

  it("is a no-op when the queue is empty", async () => {
    const result = await drainFetchQueue();

    expect(result).toMatchObject({ succeeded: 0, failed: 0, remaining: 0 });
  });
});

describe("draining and re-matching every User", () => {
  it("surfaces a newly fetched Posting on a User's Dashboard once the queue is drained", async () => {
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });
    await addBoard({ source: "greenhouse", slug: "acme" });
    boardReturns("acme", [
      greenhouseJob({ id: 1, title: "Platform Engineer", company_name: "Acme" }),
    ]);
    await startFetchRun();

    await drainAndRematch();

    expect((await readDashboard(userId)).postings.map((p) => p.title)).toEqual([
      "Platform Engineer",
    ]);
  });

  it("does not re-match while the queue still has work", async () => {
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });
    await workingBoard("acme", 1);
    await addBoard({ source: "greenhouse", slug: "globex" });
    boardReturns("globex", [
      greenhouseJob({ id: 2, title: "Platform Engineer", company_name: "globex" }),
    ]);
    await startFetchRun();

    const result = await drainAndRematch({ budgetMs: 0, batch: { batchSize: 1 } });

    expect(result.remaining).toBe(1);
    // The Posting is in the Corpus, but the re-match is deferred until the
    // sweep is done, so the Dashboard has not picked it up yet.
    expect((await readDashboard(userId)).postings).toHaveLength(0);
  });

  /**
   * A Posting a Fetch still returns re-derives its places on its own, because a
   * re-Fetch clears the derived fields. One nothing returns any more would keep
   * whatever reading it was last stored under — so the sweep re-reads the whole
   * Corpus, the same argument that puts `reclassifyCountries` here (#67, #113).
   */
  it("re-reads the places of a Posting stored under an older reading", async () => {
    await addBoard({ source: "greenhouse", slug: "acme" });
    boardReturns("acme", [
      greenhouseJob({
        id: 1,
        title: "Platform Engineer",
        location: { name: "Boston, MA / New York, NY" },
      }),
    ]);
    await startFetchRun();
    await drainAndRematch();

    // The one key the old reading gave a location naming two places: a string
    // no geocoder can place, so the radius could never drop the Posting.
    const [stored] = await listPostings();
    await getDb()
      .update(postings)
      .set({ normalizedLocations: ["boston, ma / new york, ny"] })
      .where(eq(postings.id, stored.id));

    await drainAndRematch();

    const [reread] = await listPostings();
    expect(reread.normalizedLocations).toEqual(["boston, ma", "new york, ny"]);
  });
});

describe("the last Fetch as the Dashboard sees it", () => {
  it("is null before any Fetch has run", async () => {
    expect(await readLatestFetchRun()).toBeNull();
  });

  it("reports the first, still-running sweep as running with nothing finished", async () => {
    await workingBoard("acme", 1);
    await workingBoard("globex", 2);
    await startFetchRun();

    await runFetchBatch({ batchSize: 1 });

    const summary = await readLatestFetchRun();
    expect(summary?.running).toBe(true);
    expect(summary?.finishedAt).toBeNull();
  });

  it("reports the finished run with its counts once the sweep is done", async () => {
    await workingBoard("acme", 1);
    await workingBoard("globex", 2);
    await startFetchRun();
    await drainFetchQueue();

    const summary = await readLatestFetchRun();
    expect(summary?.running).toBe(false);
    expect(summary?.finishedAt).toBeInstanceOf(Date);
    expect(summary?.succeeded).toBe(2);
    expect(summary?.failed).toBe(0);
  });

  it("lists the Boards that failed with their reasons", async () => {
    await workingBoard("acme", 1);
    await deadBoard("globex");
    await startFetchRun();
    await drainFetchQueue();

    const summary = await readLatestFetchRun();
    expect(summary?.succeeded).toBe(1);
    expect(summary?.failed).toBe(1);
    expect(summary?.failures).toHaveLength(1);
    expect(summary?.failures[0]).toMatchObject({
      source: "greenhouse",
      slug: "globex",
    });
    expect(summary?.failures[0].error).toMatch(/globex/);
    expect(summary?.failures[0].error).toMatch(/404/);
  });

  it("keeps showing the last finished run while a newer one is still sweeping", async () => {
    await workingBoard("acme", 1);
    await deadBoard("globex");
    await requestFetch();
    await drainFetchQueue();
    await ageLatestRun(FETCH_COOLDOWN_MS + 60_000);

    // A second sweep starts but has not been worked at all.
    await requestFetch();

    const summary = await readLatestFetchRun();
    // The outcome shown is the first sweep's — one failed board, still visible.
    expect(summary?.finishedAt).toBeInstanceOf(Date);
    expect(summary?.failed).toBe(1);
    expect(summary?.failures[0].slug).toBe("globex");
    // ...and the newer sweep in progress is flagged.
    expect(summary?.running).toBe(true);
  });
});
