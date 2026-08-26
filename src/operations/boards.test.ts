import { describe, expect, it } from "vitest";
import {
  addBoard,
  listBoards,
  listPostings,
  readFetchRun,
  runFetchBatch,
  seedBoards,
  startFetchRun,
} from "@/operations";
import {
  boardRefuses,
  boardReturns,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";

/** The Board entries a seed file holds. */
const CANDIDATES = [
  { source: "greenhouse", slug: "acme" },
  { source: "greenhouse", slug: "globex" },
  { source: "greenhouse", slug: "initech" },
] as const;

/**
 * The curated set: the Boards a sweep covers.
 *
 * Curation over harvesting is ADR 0003's cost decision, so this set is
 * maintained by hand — seeded once, then grown and pruned as discovery turns
 * up candidates and as Boards die.
 */
describe("seeding the curated set", () => {
  it("puts every seeded Board in the set, enabled and fetchable", async () => {
    await seedBoards(CANDIDATES);

    // Distinct ids per Board: a Source Key is the Source paired with the
    // Source's own identifier, so two Boards returning the same id would be
    // one Posting rather than two.
    CANDIDATES.forEach(({ slug }, index) => {
      boardReturns(slug, [
        greenhouseJob({ id: 100 + index, company_name: slug }),
      ]);
    });
    const runId = await startFetchRun();
    await runFetchBatch();

    const run = await readFetchRun(runId);
    expect(run.tasks.map((task) => task.slug).sort()).toEqual([
      "acme",
      "globex",
      "initech",
    ]);
    expect(run.tasks.every((task) => task.status === "succeeded")).toBe(true);
    expect(await listPostings()).toHaveLength(3);
  });

  // The seed is re-run by hand as the list grows, so it has to be safe to run
  // twice. A second row for a Board would leave the Postings already fetched
  // pointing at a Board nothing sweeps, and #7 would never expire them.
  it("keeps every Board's identity when it is seeded again", async () => {
    const first = await seedBoards(CANDIDATES);

    const second = await seedBoards([
      ...CANDIDATES,
      { source: "greenhouse", slug: "hooli" },
    ]);

    expect(second).toHaveLength(4);
    for (const board of first) {
      const reseeded = second.find((entry) => entry.slug === board.slug);
      expect(reseeded?.id).toBe(board.id);
    }
    expect(await listBoards()).toHaveLength(4);
  });
});

/**
 * Roughly one in six harvested Slugs is dead within a sampling window
 * (ADR 0003), so the curated set decays and has to be revalidated. Finding
 * what died is the first half of that; not losing it is the second.
 */
describe("revalidating the curated set", () => {
  it("reports each Board with what its last Fetch did, so the dead ones can be found", async () => {
    await seedBoards([
      { source: "greenhouse", slug: "acme" },
      { source: "greenhouse", slug: "globex" },
    ]);
    boardReturns("acme", [greenhouseJob({ id: 100 })]);
    boardRefuses("globex");

    await startFetchRun();
    await runFetchBatch();

    const [acme, globex] = await listBoards();
    expect(acme).toMatchObject({ slug: "acme", enabled: true });
    expect(acme.lastFetch).toMatchObject({ status: "succeeded", error: null });
    expect(globex.lastFetch).toMatchObject({ status: "failed" });
    expect(globex.lastFetch?.error).toMatch(/404/);
  });

  it("says so when a Board has never been fetched", async () => {
    await seedBoards([{ source: "greenhouse", slug: "acme" }]);

    const [acme] = await listBoards();

    expect(acme.lastFetch).toBeNull();
  });

  // Seeding says which Boards exist; it does not get to say which are swept.
  // The seed file is re-run every time the list grows, and a Board someone
  // turned off was turned off for a reason the file knows nothing about — so
  // disabling has to be a thing that stays done.
  it("leaves a Board someone disabled disabled when the seed is re-run", async () => {
    await seedBoards(CANDIDATES);
    await addBoard({ source: "greenhouse", slug: "globex", enabled: false });

    await seedBoards(CANDIDATES);

    const globex = (await listBoards()).find(
      (board) => board.slug === "globex",
    );
    expect(globex?.enabled).toBe(false);
    const run = await readFetchRun(await startFetchRun());
    expect(run.tasks.map((task) => task.slug).sort()).toEqual([
      "acme",
      "initech",
    ]);
  });

  // A hand-edited list is exactly where a Slug ends up written twice, and one
  // statement cannot update the same row twice.
  it("copes with the same Board listed twice in the seed", async () => {
    const seeded = await seedBoards([
      { source: "greenhouse", slug: "acme" },
      { source: "greenhouse", slug: "acme" },
    ]);

    expect(seeded).toHaveLength(1);
    expect(await listBoards()).toHaveLength(1);
  });

  // Disabled rather than deleted: deleting a dead Board would orphan every
  // Posting it ever published, and let the next discovery run rediscover the
  // Slug and add it straight back.
  it("stops sweeping a disabled Board without losing it or its Postings", async () => {
    const [acme] = await seedBoards([{ source: "greenhouse", slug: "acme" }]);
    boardReturns("acme", [greenhouseJob({ id: 100 })]);
    await startFetchRun();
    await runFetchBatch();

    await addBoard({ source: "greenhouse", slug: "acme", enabled: false });

    const laterRun = await readFetchRun(await startFetchRun());
    expect(laterRun.tasks).toEqual([]);
    const [stillThere] = await listBoards();
    expect(stillThere).toMatchObject({ id: acme.id, enabled: false });
    expect(await listPostings()).toHaveLength(1);
  });
});
