import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addBoard,
  fetchBoard,
  isExpired,
  listPostings,
  readFetchRun,
  runFetchBatch,
  startFetchRun,
  type Board,
} from "@/operations";
import {
  boardAnswersWithTheWrongShape,
  boardIsUnreachable,
  boardNeverAnswers,
  boardRefuses,
  boardReturns,
  greenhouseBoard,
  greenhouseBoardUrl,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";
import { deferred } from "@/test/deferred";
import { server } from "@/test/msw";
import type { Posting } from "@/db/schema";

/** The Board under test, in the curated set before each test. */
let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** The Posting a Board published under `sourceId`, as the Corpus holds it. */
async function posting(sourceId: string): Promise<Posting> {
  const found = (await listPostings()).find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!found) throw new Error(`The Corpus holds no Posting "${sourceId}"`);
  return found;
}

/** Seeds the Corpus with the two Postings the Board starts out publishing. */
async function boardStartsWithTwoPostings(): Promise<void> {
  boardReturns("acme", [
    greenhouseJob({ id: 100, title: "Staff Engineer" }),
    greenhouseJob({ id: 200, title: "Product Designer" }),
  ]);
  await fetchBoard(acme);
}

/** A Fetch of the Board in which only the first Posting is still listed. */
async function boardDropsTheSecondPosting(): Promise<void> {
  boardReturns("acme", [greenhouseJob({ id: 100, title: "Staff Engineer" })]);
  await fetchBoard(acme);
}

/**
 * Expiry by absence: a Board that stops returning a Posting is the only signal
 * any Source offers that a role has been filled (ADR 0004).
 */
describe("expiring Postings a Board stopped returning", () => {
  // One missing Fetch is not enough. A Source that drops a Posting from one
  // response and returns it in the next would otherwise expire live roles.
  it("does not expire a Posting absent from only one successful Fetch", async () => {
    await boardStartsWithTwoPostings();

    await boardDropsTheSecondPosting();

    expect(isExpired(await posting("200"))).toBe(false);
  });

  it("expires a Posting absent from two consecutive successful Fetches", async () => {
    await boardStartsWithTwoPostings();

    await boardDropsTheSecondPosting();
    await boardDropsTheSecondPosting();

    expect(isExpired(await posting("200"))).toBe(true);
  });

  it("leaves the Postings the Board still returns alone", async () => {
    await boardStartsWithTwoPostings();

    await boardDropsTheSecondPosting();
    await boardDropsTheSecondPosting();

    expect(isExpired(await posting("100"))).toBe(false);
  });

  // A Posting a User marked `applied` vanishing from their own tracker is the
  // worst failure this application could have, so expiry marks rather than
  // deletes. Review State (#10) hangs off the Posting's id, so the row keeping
  // its identity and its facts is what keeps that state intact.
  it("retains an Expired Posting, unchanged apart from being Expired", async () => {
    await boardStartsWithTwoPostings();
    const before = await posting("200");

    await boardDropsTheSecondPosting();
    await boardDropsTheSecondPosting();

    const expired = await posting("200");
    expect(await listPostings()).toHaveLength(2);
    // Every column but the absence count is exactly as the Fetch that last saw
    // the Posting left it — `last_seen_at` included.
    expect(expired).toEqual({
      ...before,
      absentFetches: expired.absentFetches,
    });
    expect(isExpired(expired)).toBe(true);
  });

  // Companies re-list roles. Absence is counted consecutively, so a Fetch that
  // returns a Posting again both resets the count and undoes the expiry.
  it("un-expires a Posting the Board started returning again", async () => {
    await boardStartsWithTwoPostings();
    await boardDropsTheSecondPosting();
    await boardDropsTheSecondPosting();

    await boardStartsWithTwoPostings();

    expect(isExpired(await posting("200"))).toBe(false);
  });

  it("starts the count over when a Posting reappears midway", async () => {
    await boardStartsWithTwoPostings();

    await boardDropsTheSecondPosting();
    await boardStartsWithTwoPostings();
    await boardDropsTheSecondPosting();

    expect(isExpired(await posting("200"))).toBe(false);
  });

  // A Board whose last role was filled returns an empty list, which is a
  // successful Fetch like any other.
  it("expires every Posting on a Board that returned none", async () => {
    await boardStartsWithTwoPostings();

    boardReturns("acme", []);
    await fetchBoard(acme);
    boardReturns("acme", []);
    await fetchBoard(acme);

    const corpus = await listPostings();
    expect(corpus).toHaveLength(2);
    expect(corpus.every(isExpired)).toBe(true);
  });

  // A sweep fetches hundreds of Boards in a row, and a Posting is absent from
  // all but one of them. Only its own Board's Fetches are evidence about it.
  it("counts a Posting's absence only against its own Board", async () => {
    await boardStartsWithTwoPostings();
    const globex = await addBoard({ source: "greenhouse", slug: "globex" });

    boardReturns("globex", [greenhouseJob({ id: 300, company_name: "Globex" })]);
    await fetchBoard(globex);
    boardReturns("globex", [greenhouseJob({ id: 300, company_name: "Globex" })]);
    await fetchBoard(globex);

    expect(isExpired(await posting("100"))).toBe(false);
    expect(isExpired(await posting("200"))).toBe(false);
  });
});

/**
 * The invariant this all rests on: only a *successful* Fetch of a Board is
 * evidence that a Posting the Board did not return is gone (ADR 0004).
 */
describe("when a Board's Fetch fails", () => {
  // Each of the failure modes ADR 0004 names, because they reach the Corpus
  // through different code and only the last one looks like success. A Fetch
  // that gave up waiting is a failure like any other, so it belongs here
  // rather than in a case of its own.
  it.each([
    ["the Board could not be reached at all", boardIsUnreachable],
    ["the Board refused to serve it", boardRefuses],
    ["the Board never answered", boardNeverAnswers],
    ["the response failed validation", boardAnswersWithTheWrongShape],
  ])("expires nothing across two Fetches where %s", async (_case, breakBoard) => {
    await boardStartsWithTwoPostings();
    const before = await listPostings();

    // A ceiling short enough that the silent Board is waited on for
    // milliseconds; the other cases fail before it is ever reached.
    breakBoard("acme");
    await expect(fetchBoard(acme, { timeoutMs: 50 })).rejects.toThrow();
    await expect(fetchBoard(acme, { timeoutMs: 50 })).rejects.toThrow();

    // Every column, so a failed Fetch is shown to have moved neither the
    // absence count nor `last_seen_at` — either would be a step towards expiry.
    expect(await listPostings()).toEqual(before);
    expect(before.some(isExpired)).toBe(false);
  });

  // The case that looks like success: the request returned 200, the body
  // parsed as JSON, and only the shape was wrong. Letting it fall through to
  // "this Board returned no Postings" would expire every Greenhouse Posting in
  // the Corpus over two nights, with nothing failing that anyone would notice
  // until the Dashboard was empty.
  it("records a malformed response as errored, and expires nothing over two runs", async () => {
    await boardStartsWithTwoPostings();
    const before = await listPostings();

    const runIds: string[] = [];
    for (let night = 0; night < 2; night++) {
      boardAnswersWithTheWrongShape("acme");
      const runId = await startFetchRun();
      await runFetchBatch();
      runIds.push(runId);
    }

    for (const runId of runIds) {
      const [task] = (await readFetchRun(runId)).tasks;
      expect(task.status).toBe("failed");
      expect(task.error).toMatch(/title/);
    }
    const corpus = await listPostings();
    expect(corpus).toEqual(before);
    expect(corpus.some(isExpired)).toBe(false);
  });

  // A Board that fails between two successful Fetches has not interrupted the
  // absence — it simply said nothing — so the two successes still expire.
  it("neither advances nor resets the count it took no part in", async () => {
    await boardStartsWithTwoPostings();

    await boardDropsTheSecondPosting();
    boardIsUnreachable("acme");
    await expect(fetchBoard(acme)).rejects.toThrow();
    await boardDropsTheSecondPosting();

    expect(isExpired(await posting("200"))).toBe(true);
  });
});

/**
 * A Worker still alive when its Claim went stale, which is the case that makes
 * counting absences unlike storing Postings: storing the same Board twice is
 * harmless, because the upsert is idempotent, but counting the same night's
 * absence twice expires a live role a night early.
 */
describe("when a stale Claim is reclaimed", () => {
  it("counts one night's absence once, however many Workers fetched the Board", async () => {
    await boardStartsWithTwoPostings();
    await startFetchRun();

    // The slow Worker, its Fetch held open past the life of its Claim.
    const reached = deferred<void>();
    const held = deferred<Response>();
    server.use(
      http.get(greenhouseBoardUrl("acme"), () => {
        reached.resolve();
        return held.promise;
      }),
    );
    const slow = runFetchBatch().catch(() => undefined);
    await reached.promise;

    // A second Worker takes the task over and finishes it. The Board has
    // stopped listing Posting 200, and this is the first Fetch to say so.
    boardReturns("acme", [greenhouseJob({ id: 100, title: "Staff Engineer" })]);
    expect(await runFetchBatch({ claimTimeoutMs: 0 })).toMatchObject({
      succeeded: 1,
    });
    expect(isExpired(await posting("200"))).toBe(false);

    // The slow Worker's Board finally answers, saying exactly the same thing.
    // It no longer holds the Claim, so what it fetched is not a second night's
    // evidence and must not be counted as one.
    held.resolve(
      HttpResponse.json(
        greenhouseBoard([greenhouseJob({ id: 100, title: "Staff Engineer" })]),
      ),
    );
    await slow;

    expect(isExpired(await posting("200"))).toBe(false);
  });
});
