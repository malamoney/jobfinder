import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { postings } from "@/db/schema";
import {
  addBoard,
  boardTimeoutFor,
  fetchBoard,
  isExpired,
  listPostings,
  readFetchRun,
  runFetchBatch,
  startFetchRun,
  type Board,
} from "@/operations";
import {
  himalayasJob,
  himalayasRefuses,
  himalayasReturns,
} from "@/test/fixtures/himalayas";
import {
  usajobsItem,
  usajobsRefuses,
  usajobsReturns,
} from "@/test/fixtures/usajobs";

/**
 * The two aggregator Sources added in #15, each fetched for real through
 * `fetchBoard` — a real Fetch against a real database, MSW supplying the
 * response — so one assertion covers the adapter, the Source Key upsert, and
 * persistence together, the way the ATS adapters are tested.
 *
 * What is asserted here is what an aggregator does that a Board does not: it
 * pages through a feed it never sees the whole of, so its Postings expire by
 * the close date the feed publishes rather than by absence from a Fetch.
 */

/** A field taken away from a job, as a broken feed would send it. */
function without(
  job: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const broken = { ...job };
  delete broken[field];
  return broken;
}

/** Fields no adapter has heard of, in a shape a strict parse would reject. */
const FIELDS_NOBODY_ASKED_FOR = {
  pay_transparency_disclosure: { min: 180_000, max: 220_000 },
  compliance_flags: [{ type: "ofccp", required: true }],
};

describe("fetching from USAJOBS", () => {
  let board: Board;

  beforeEach(async () => {
    process.env.USAJOBS_API_KEY = "test-key";
    process.env.USAJOBS_USER_AGENT = "jobfinder-tests@example.com";
    board = await addBoard({ source: "usajobs", slug: "software-engineer" });
  });

  afterEach(() => {
    delete process.env.USAJOBS_API_KEY;
    delete process.env.USAJOBS_USER_AGENT;
  });

  it("stores the announcements the search returned", async () => {
    usajobsReturns([[usajobsItem()]]);

    await fetchBoard(board);

    const [posting] = await listPostings();
    expect(posting).toMatchObject({
      source: "usajobs",
      sourceId: "833819900",
      boardId: board.id,
      company: "Naval Air Systems Command",
      title: "Staff Engineer, Infrastructure",
      location: "Patuxent River, Maryland",
      applyUrl: "https://www.usajobs.gov/job/833819900",
      postedAt: new Date("2026-08-06"),
      // The announcement's own close date — the expiry signal for a Source
      // whose Fetch never sees the whole feed.
      expiresAt: new Date("2026-09-06"),
    });
  });

  it("reads the pay from the structured remuneration field", async () => {
    usajobsReturns([[usajobsItem()]]);

    await fetchBoard(board);

    expect((await listPostings())[0]).toMatchObject({
      salaryMin: 112_015,
      salaryMax: 145_617,
      salaryPeriod: "year",
    });
  });

  it("marks a remote announcement remote, where the funnel reads it", async () => {
    usajobsReturns([[usajobsItem({ RemoteIndicator: true })]]);

    await fetchBoard(board);

    expect((await listPostings())[0].location).toBe(
      "Remote - Patuxent River, Maryland",
    );
  });

  it("follows the page count across every page of results", async () => {
    usajobsReturns([
      [usajobsItem({}, "1"), usajobsItem({}, "2")],
      [usajobsItem({}, "3")],
    ]);

    await fetchBoard(board);

    expect((await listPostings()).map((p) => p.sourceId).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("ignores a field USAJOBS added since the adapter was written", async () => {
    usajobsReturns([[usajobsItem(FIELDS_NOBODY_ASKED_FOR)]]);

    await fetchBoard(board);

    const postingsNow = await listPostings();
    expect(postingsNow).toHaveLength(1);
    expect(postingsNow[0]).not.toHaveProperty("pay_transparency_disclosure");
  });

  it("fails the Fetch when a field it depends on is missing", async () => {
    usajobsReturns([
      [
        {
          MatchedObjectId: "833819900",
          MatchedObjectDescriptor: without(
            usajobsItem().MatchedObjectDescriptor as Record<string, unknown>,
            "PositionTitle",
          ),
        },
      ],
    ]);

    await expect(fetchBoard(board)).rejects.toThrow(/software-engineer/);
    expect(await listPostings()).toEqual([]);
  });

  it("fails the Fetch when the search could not be read at all", async () => {
    usajobsRefuses();

    await expect(fetchBoard(board)).rejects.toThrow(/500/);
    expect(await listPostings()).toEqual([]);
  });

  // "A missing or invalid API key produces a recorded task failure, not a
  // silent empty result" — because ADR 0004 reads an empty successful Fetch as
  // every federal Posting having expired.
  it("records a task failure when the API key is not configured", async () => {
    delete process.env.USAJOBS_API_KEY;
    usajobsReturns([[usajobsItem()]]);
    const runId = await startFetchRun();

    const result = await runFetchBatch();

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    const task = (await readFetchRun(runId)).tasks.find(
      (t) => t.slug === "software-engineer",
    )!;
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/USAJOBS_API_KEY/);
    expect(await listPostings()).toEqual([]);
  });
});

describe("fetching from Himalayas", () => {
  let board: Board;

  beforeEach(async () => {
    board = await addBoard({ source: "himalayas", slug: "remote" });
  });

  it("stores the jobs the feed returned", async () => {
    himalayasReturns([[himalayasJob()]]);

    await fetchBoard(board);

    const [posting] = await listPostings();
    expect(posting).toMatchObject({
      source: "himalayas",
      sourceId:
        "https://himalayas.app/companies/acme/jobs/staff-engineer-infrastructure",
      boardId: board.id,
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      // Every Himalayas role is remote; the restriction narrows where.
      location: "Remote - United States",
      applyUrl:
        "https://himalayas.app/companies/acme/jobs/staff-engineer-infrastructure",
      // pubDate / expiryDate are epoch seconds.
      postedAt: new Date(1_788_026_464 * 1000),
      expiresAt: new Date(1_793_212_196 * 1000),
    });
  });

  it("reads the pay from the structured salary fields", async () => {
    himalayasReturns([[himalayasJob()]]);

    await fetchBoard(board);

    expect((await listPostings())[0]).toMatchObject({
      salaryMin: 180_000,
      salaryMax: 220_000,
      salaryPeriod: "year",
    });
  });

  it("follows the cursor across pages and stops when it runs out", async () => {
    himalayasReturns([
      [himalayasJob({ guid: "https://himalayas.app/jobs/1" })],
      [himalayasJob({ guid: "https://himalayas.app/jobs/2" })],
    ]);

    await fetchBoard(board);

    expect((await listPostings()).map((p) => p.sourceId).sort()).toEqual([
      "https://himalayas.app/jobs/1",
      "https://himalayas.app/jobs/2",
    ]);
  });

  it("ignores a field Himalayas added since the adapter was written", async () => {
    himalayasReturns([[himalayasJob(FIELDS_NOBODY_ASKED_FOR)]]);

    await fetchBoard(board);

    expect(await listPostings()).toHaveLength(1);
  });

  it("fails the Fetch when a field it depends on is missing", async () => {
    himalayasReturns([[without(himalayasJob(), "guid")]]);

    await expect(fetchBoard(board)).rejects.toThrow(/remote/);
    expect(await listPostings()).toEqual([]);
  });

  it("fails the Fetch when the feed could not be read at all", async () => {
    himalayasRefuses();

    await expect(fetchBoard(board)).rejects.toThrow(/500/);
    expect(await listPostings()).toEqual([]);
  });
});

describe("how an aggregator Posting expires", () => {
  beforeEach(() => {
    process.env.USAJOBS_API_KEY = "test-key";
    process.env.USAJOBS_USER_AGENT = "jobfinder-tests@example.com";
  });

  afterEach(() => {
    delete process.env.USAJOBS_API_KEY;
    delete process.env.USAJOBS_USER_AGENT;
  });

  // The invariant #15 turns on: an aggregator Fetch is a slice of a feed, not a
  // Board's whole state, so a Posting it did not return this time is not gone.
  it("never counts a Fetch that dropped a Posting as absence", async () => {
    const board = await addBoard({ source: "himalayas", slug: "remote" });
    himalayasReturns([
      [
        himalayasJob({ guid: "https://himalayas.app/jobs/kept" }),
        himalayasJob({ guid: "https://himalayas.app/jobs/dropped" }),
      ],
    ]);
    await fetchBoard(board);

    // Two Fetches in a row without the second job — enough to expire an ATS
    // Posting by absence.
    himalayasReturns([[himalayasJob({ guid: "https://himalayas.app/jobs/kept" })]]);
    await fetchBoard(board);
    himalayasReturns([[himalayasJob({ guid: "https://himalayas.app/jobs/kept" })]]);
    await fetchBoard(board);

    const dropped = (await listPostings()).find(
      (p) => p.sourceId === "https://himalayas.app/jobs/dropped",
    )!;
    expect(dropped.absentFetches).toBe(0);
    expect(isExpired(dropped)).toBe(false);
  });

  it("expires a Posting once the close date the feed published has passed", async () => {
    const board = await addBoard({ source: "himalayas", slug: "remote" });
    const yesterday = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    himalayasReturns([[himalayasJob({ expiryDate: yesterday })]]);

    await fetchBoard(board);

    expect(isExpired((await listPostings())[0])).toBe(true);
  });

  it("keeps a Posting live while its published close date is in the future", async () => {
    const board = await addBoard({ source: "himalayas", slug: "remote" });
    const nextWeek = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    himalayasReturns([[himalayasJob({ expiryDate: nextWeek })]]);

    await fetchBoard(board);

    expect(isExpired((await listPostings())[0])).toBe(false);
  });

  it("refreshes the close date a re-Fetch brings back", async () => {
    const board = await addBoard({ source: "himalayas", slug: "remote" });
    himalayasReturns([[himalayasJob({ expiryDate: 1_793_212_196 })]]);
    await fetchBoard(board);

    const pushedBack = 1_793_212_196 + 30 * 24 * 60 * 60;
    himalayasReturns([[himalayasJob({ expiryDate: pushedBack })]]);
    await fetchBoard(board);

    const [posting] = await listPostings();
    expect(posting.expiresAt).toEqual(new Date(pushedBack * 1000));
  });

  it("leaves an ATS Posting's close date null", async () => {
    const board = await addBoard({ source: "greenhouse", slug: "acme" });
    await getDb()
      .insert(postings)
      .values({
        source: "greenhouse",
        sourceId: "1",
        boardId: board.id,
        company: "Acme",
        title: "Staff Engineer",
        description: "Build the thing.",
        dedupKey: "acme|staff engineer|",
        applyUrl: "https://example.com/1",
      });

    const [posting] = await listPostings();
    expect(posting.expiresAt).toBeNull();
  });
});

describe("boardTimeoutFor", () => {
  it("raises the ceiling to an aggregator's longer floor", () => {
    expect(boardTimeoutFor("himalayas", 20_000)).toBe(35_000);
    expect(boardTimeoutFor("usajobs", 20_000)).toBe(35_000);
  });

  it("leaves an ATS Source on the caller's ceiling", () => {
    expect(boardTimeoutFor("greenhouse", 20_000)).toBe(20_000);
  });

  it("never lowers a ceiling already above the floor", () => {
    expect(boardTimeoutFor("himalayas", 45_000)).toBe(45_000);
  });
});
