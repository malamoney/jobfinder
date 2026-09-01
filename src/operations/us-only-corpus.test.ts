import { beforeEach, describe, expect, it } from "vitest";
import {
  addBoard,
  drainFetchQueue,
  fetchBoard,
  isExpired,
  listPostings,
  readLatestFetchRun,
  startFetchRun,
  type Board,
} from "@/operations";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";

/** The Board every role in these tests is published on. */
let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** A Greenhouse role at `location`, one company per id so it dedups distinctly. */
function roleAt(id: number, location: string): Record<string, unknown> {
  return greenhouseJob({
    id,
    company_name: `Company ${id}`,
    location: { name: location },
  });
}

/**
 * The Corpus holds only US-based roles: `reconcileBoard` classifies every role a
 * Fetch returned and stores the `us` ones alone (ADR 0010). A role placed
 * abroad, and one whose location text names no place, are both dropped before
 * the upsert — never written, so they cost the Corpus nothing.
 */
describe("US-only ingestion", () => {
  it("stores the US roles a Board returned and drops the rest", async () => {
    boardReturns("acme", [
      roleAt(1, "Boston, MA"),
      roleAt(2, "London, UK"),
      roleAt(3, "Remote"),
      roleAt(4, "Remote - US"),
      roleAt(5, "Toronto, ON"),
    ]);

    await fetchBoard(acme);

    expect((await listPostings()).map((posting) => posting.sourceId).sort()).toEqual(
      ["1", "4"],
    );
  });

  it("writes country = 'us' on every stored role", async () => {
    boardReturns("acme", [roleAt(1, "Austin, TX")]);

    await fetchBoard(acme);

    expect((await listPostings())[0].country).toBe("us");
  });

  it("re-deriving country on a re-Fetch keeps the row otherwise unchanged", async () => {
    boardReturns("acme", [roleAt(1, "Austin, TX")]);
    await fetchBoard(acme);
    const before = (await listPostings())[0];

    boardReturns("acme", [roleAt(1, "Austin, TX")]);
    await fetchBoard(acme);
    const after = (await listPostings())[0];

    expect(after.country).toBe("us");
    expect(after.firstSeenAt).toEqual(before.firstSeenAt);
  });

  // ADR 0004: only a *successful* Fetch is evidence a Posting is gone. A Board
  // that returned forty roles of which thirty are foreign was still a successful
  // Fetch of the ten US ones the Corpus keeps — the roles it still lists must
  // not read as an absence.
  it("leaves a US role alone while the Board keeps listing it, foreign roles beside it", async () => {
    boardReturns("acme", [roleAt(1, "Boston, MA")]);
    await fetchBoard(acme);

    for (let night = 0; night < 2; night++) {
      boardReturns("acme", [roleAt(1, "Boston, MA"), roleAt(2, "London, UK")]);
      await fetchBoard(acme);
    }

    const stored = await listPostings();
    expect(stored.map((posting) => posting.sourceId)).toEqual(["1"]);
    expect(stored[0].absentFetches).toBe(0);
    expect(isExpired(stored[0])).toBe(false);
  });

  // A stored US role whose company edits its location to somewhere abroad is not
  // re-stored (it is no longer a `us` role) — so it must trend to Expired by
  // absence, which hides it from the Dashboard without deleting the row a User's
  // Review State hangs off.
  it("expires a stored role whose location was edited to somewhere abroad", async () => {
    boardReturns("acme", [roleAt(1, "Boston, MA")]);
    await fetchBoard(acme);

    for (let night = 0; night < 2; night++) {
      boardReturns("acme", [roleAt(1, "London, UK")]);
      await fetchBoard(acme);
    }

    const [stored] = await listPostings();
    expect(stored.sourceId).toBe("1");
    expect(stored.location).toBe("Boston, MA");
    expect(isExpired(stored)).toBe(true);
  });

  it("counts the roles it dropped on the fetch-run summary", async () => {
    boardReturns("acme", [
      roleAt(1, "Boston, MA"),
      roleAt(2, "London, UK"),
      roleAt(3, "Berlin, Germany"),
    ]);

    await startFetchRun();
    await drainFetchQueue();

    expect((await readLatestFetchRun())?.nonUsDropped).toBe(2);
  });
});
