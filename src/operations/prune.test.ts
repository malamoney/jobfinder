import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  addBoard,
  drainAndRematch,
  listPostings,
  pruneNonUsPostings,
  readLatestFetchRun,
  saveCriteria,
  setNotes,
  setStatus,
  startFetchRun,
  type Board,
} from "@/operations";
import { getDb } from "@/db";
import { postings, user } from "@/db/schema";
import type { Country } from "@/postings/country";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";

/**
 * Pruning the roles the Corpus should never have held (ADR 0010): those the
 * location text does not place in the United States, that no User has an opinion
 * on. Ingestion keeps new foreign roles out; this clears the ones stored before
 * that gate existed.
 *
 * Tested through the `@/operations` seam against a real Postgres. Foreign rows
 * are inserted directly — `reconcileBoard` would refuse to store them now —
 * which is exactly the pre-ADR-0010 state the prune exists to resolve.
 */

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

let board: Board;

beforeEach(async () => {
  board = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** How a role was stored, as the prune reads it. */
type StoredRole = {
  sourceId: string;
  country: Country | null;
  location: string | null;
  dedupKey?: string;
  title?: string;
  company?: string;
};

/** Inserts a role straight into the Corpus, bypassing ingestion's US-only gate. */
async function storedRole(role: StoredRole): Promise<string> {
  const [row] = await getDb()
    .insert(postings)
    .values({
      source: "greenhouse",
      sourceId: role.sourceId,
      boardId: board.id,
      company: role.company ?? "Acme",
      title: role.title ?? "Staff Engineer",
      description: "<p>Build the thing.</p>",
      dedupKey: role.dedupKey ?? `acme|staff engineer|${role.sourceId}`,
      location: role.location,
      country: role.country,
      applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${role.sourceId}`,
    })
    .returning({ id: postings.id });
  return row.id;
}

/** The Source Keys still in the Corpus, sorted. */
async function remaining(): Promise<string[]> {
  return (await listPostings()).map((posting) => posting.sourceId).sort();
}

describe("pruning non-US roles", () => {
  it("deletes a foreign role no User has Review State on", async () => {
    await storedRole({ sourceId: "1", country: "us", location: "Austin, TX" });
    await storedRole({ sourceId: "2", country: "non-us", location: "London, UK" });

    const deleted = await pruneNonUsPostings();

    expect(deleted).toBe(1);
    expect(await remaining()).toEqual(["1"]);
  });

  it("deletes a placeless role — 'unknown' is pruned like 'non-us'", async () => {
    await storedRole({ sourceId: "1", country: "unknown", location: "Remote" });

    await pruneNonUsPostings();

    expect(await remaining()).toEqual([]);
  });

  // ADR 0004's invariant, restated for the prune: a role a User acted on is
  // never removed from their tracker, whatever its location says.
  it("never deletes a foreign role a User has any Review State on", async () => {
    const userId = await givenAUser();
    const applied = await storedRole({
      sourceId: "1",
      country: "non-us",
      location: "London, UK",
    });
    const noted = await storedRole({
      sourceId: "2",
      country: "non-us",
      location: "Berlin, Germany",
    });
    await setStatus(userId, applied, "applied");
    await setNotes(userId, noted, "Referred by a friend.");

    const deleted = await pruneNonUsPostings();

    expect(deleted).toBe(0);
    expect(await remaining()).toEqual(["1", "2"]);
  });

  it("classifies a legacy row whose country was never derived, then prunes it", async () => {
    await storedRole({ sourceId: "1", country: null, location: "Paris, France" });
    await storedRole({ sourceId: "2", country: null, location: "Denver, CO" });

    const deleted = await pruneNonUsPostings();

    expect(deleted).toBe(1);
    expect(await remaining()).toEqual(["2"]);
    // The kept legacy row is now classified, so a later prune does not reconsider it.
    const [kept] = await listPostings();
    expect(kept.country).toBe("us");
  });

  // Review State and matched keywords are read across every member of a Dedup
  // Key group (ADR 0006). Pruning a foreign member must not cost the group the
  // member that carries its Review State, nor its US member.
  it("keeps a Dedup Key group's US member and its reviewed member", async () => {
    const userId = await givenAUser();
    const key = "acme|staff platform engineer|remote";
    const member = (sourceId: string, country: Country, location: string) =>
      storedRole({
        sourceId,
        country,
        location,
        dedupKey: key,
        title: "Staff Platform Engineer",
      });
    await member("10", "us", "Remote - US");
    const foreignReviewed = await member("11", "non-us", "London, UK");
    await member("12", "non-us", "Berlin, Germany");
    await setStatus(userId, foreignReviewed, "interested");

    const deleted = await pruneNonUsPostings();

    expect(deleted).toBe(1);
    expect(await remaining()).toEqual(["10", "11"]);
  });

  it("stops at its batch size and leaves the rest for the next run", async () => {
    for (let i = 0; i < 5; i++) {
      await storedRole({
        sourceId: String(i),
        country: "non-us",
        location: "London, UK",
      });
    }

    const first = await pruneNonUsPostings(2);
    const second = await pruneNonUsPostings(2);

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect((await listPostings()).length).toBe(1);
  });

  it("is a no-op when the Corpus is all US roles", async () => {
    await storedRole({ sourceId: "1", country: "us", location: "Austin, TX" });

    expect(await pruneNonUsPostings()).toBe(0);
  });
});

describe("the sweep's closing prune", () => {
  it("runs once the queue is drained and records the count on the run summary", async () => {
    await storedRole({ sourceId: "old-1", country: "non-us", location: "London, UK" });
    await storedRole({ sourceId: "old-2", country: "unknown", location: "Remote" });

    await addBoard({ source: "greenhouse", slug: "globex" });
    boardReturns("globex", [
      greenhouseJob({ id: 1, company_name: "Globex", location: { name: "Austin, TX" } }),
    ]);
    await startFetchRun();
    await drainAndRematch();

    expect(await remaining()).toEqual(["1"]);
    expect((await readLatestFetchRun())?.nonUsPruned).toBe(2);
  });

  it("does not prune while the queue still has work", async () => {
    await storedRole({ sourceId: "old-1", country: "non-us", location: "London, UK" });
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });
    await addBoard({ source: "greenhouse", slug: "globex" });
    boardReturns("globex", [greenhouseJob({ id: 1, company_name: "Globex" })]);
    await addBoard({ source: "greenhouse", slug: "initech" });
    boardReturns("initech", [greenhouseJob({ id: 2, company_name: "Initech" })]);
    await startFetchRun();

    await drainAndRematch({ budgetMs: 0, batch: { batchSize: 1 } });

    expect((await listPostings()).some((p) => p.sourceId === "old-1")).toBe(true);
  });
});
