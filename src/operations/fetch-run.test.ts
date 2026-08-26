import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  addBoard,
  listPostings,
  readFetchRun,
  runFetchBatch,
  startFetchRun,
  type FetchRunReport,
  type FetchTaskReport,
} from "@/operations";
import {
  boardNeverAnswers,
  boardRefuses,
  boardReturns,
  greenhouseBoardUrl,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";
import { deferred } from "@/test/deferred";
import { server } from "@/test/msw";
import {
  DEFAULT_BOARD_TIMEOUT_MS,
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_TIME_BUDGET_MS,
} from "./fetch-run";

/** Adds an enabled Greenhouse Board that returns one Posting when fetched. */
async function workingBoard(slug: string, id: number): Promise<void> {
  await addBoard({ source: "greenhouse", slug });
  boardReturns(slug, [greenhouseJob({ id, company_name: slug })]);
}

/** Adds an enabled Greenhouse Board that cannot be read at all. */
async function unreachableBoard(slug: string): Promise<void> {
  await addBoard({ source: "greenhouse", slug });
  boardRefuses(slug);
}

/** The task a run recorded for one Board. */
function taskFor(run: FetchRunReport, slug: string): FetchTaskReport {
  const task = run.tasks.find((candidate) => candidate.slug === slug);
  if (!task) throw new Error(`The run has no task for Board "${slug}"`);
  return task;
}

describe("starting a Fetch run", () => {
  it("enqueues one task per enabled Board", async () => {
    await addBoard({ source: "greenhouse", slug: "acme" });
    await addBoard({ source: "greenhouse", slug: "globex" });
    await addBoard({ source: "greenhouse", slug: "initech", enabled: false });

    const run = await readFetchRun(await startFetchRun());

    expect(run.tasks.map((task) => task.slug).sort()).toEqual([
      "acme",
      "globex",
    ]);
    expect(run.tasks.map((task) => task.status)).toEqual(["pending", "pending"]);
  });

  // The run's own record of when it happened, which #17 shows the user. A run
  // with tasks still queued has not finished, whatever any single task did.
  it("records when it started and leaves it unfinished while tasks remain", async () => {
    await workingBoard("acme", 100);

    const run = await readFetchRun(await startFetchRun());

    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeNull();
  });
});

describe("working the queue", () => {
  it("fetches every queued Board into the Corpus and records each task", async () => {
    await workingBoard("acme", 100);
    await workingBoard("globex", 200);
    const runId = await startFetchRun();

    await runFetchBatch();

    const run = await readFetchRun(runId);
    expect(run.tasks.map((task) => task.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    const companies = (await listPostings()).map((posting) => posting.company);
    expect(companies.sort()).toEqual(["acme", "globex"]);
  });

  // The point of the queue: a sweep of hundreds of Boards is not bounded by
  // how long one invocation may run, because no invocation has to finish it.
  it("leaves what does not fit in the batch for the next invocation", async () => {
    await workingBoard("acme", 100);
    await workingBoard("globex", 200);
    await workingBoard("initech", 300);
    const runId = await startFetchRun();

    const first = await runFetchBatch({ batchSize: 2 });

    expect(first).toEqual({ succeeded: 2, failed: 0, remaining: 1 });
    const midway = await readFetchRun(runId);
    expect(midway.tasks.filter((task) => task.status === "pending")).toHaveLength(
      1,
    );
    expect(midway.finishedAt).toBeNull();

    const second = await runFetchBatch({ batchSize: 2 });

    expect(second).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
    const done = await readFetchRun(runId);
    expect(done.tasks.map((task) => task.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(done.finishedAt).toBeInstanceOf(Date);
    expect(await listPostings()).toHaveLength(3);
  });

  it("does nothing when the queue is empty", async () => {
    expect(await runFetchBatch()).toEqual({
      succeeded: 0,
      failed: 0,
      remaining: 0,
    });
  });

  /**
   * The budget only means anything if one Board cannot spend all of it. A
   * Source that accepts the request and goes quiet would otherwise hold the
   * invocation until the platform killed it, and the Boards queued behind it
   * would wait for a run nobody was left to finish.
   */
  it("does not let silent Boards spend more than the batch's budget", async () => {
    for (const slug of ["acme", "globex", "initech"]) {
      await addBoard({ source: "greenhouse", slug });
      boardNeverAnswers(slug);
    }
    await startFetchRun();

    const started = Date.now();
    const result = await runFetchBatch({
      timeBudgetMs: 150,
      boardTimeoutMs: 100,
    });

    // The point is not the exact figure — it is that the batch returned on
    // something like its own budget rather than on three silent Boards.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBeGreaterThan(0);
    // Work left for the next invocation, rather than a budget burnt through.
    expect(result.remaining).toBeGreaterThan(0);
  });

  // The budget is what a serverless invocation actually has, so it is checked
  // between Boards rather than trusted to be enough for the whole batch. One
  // Board is always fetched, or a spent budget would stall the queue forever.
  it("stops taking on Boards once its time budget is spent", async () => {
    await workingBoard("acme", 100);
    await workingBoard("globex", 200);
    await startFetchRun();

    const result = await runFetchBatch({ batchSize: 10, timeBudgetMs: 0 });

    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 1 });
  });

  // What "finished" means for a run that outlives every invocation working it:
  // the queue is empty, not that any particular worker returned.
  it("closes the run once no task is left to work on", async () => {
    await workingBoard("acme", 100);
    const runId = await startFetchRun();

    await runFetchBatch();

    const run = await readFetchRun(runId);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.finishedAt!.getTime()).toBeGreaterThanOrEqual(
      run.startedAt.getTime(),
    );
  });
});

/**
 * The three ceilings only work as a set, and each is plausible on its own, so
 * the ordering between them is asserted rather than left to whoever edits one
 * next. A Board bounded by more than the batch that started it, or a batch
 * bounded by more than the Claim it holds, would put back exactly the overrun
 * these were introduced to stop.
 */
describe("the ceilings a sweep is bounded by", () => {
  it("keeps a Board inside its batch, and a batch inside its Claim", () => {
    expect(DEFAULT_BOARD_TIMEOUT_MS).toBeLessThanOrEqual(DEFAULT_TIME_BUDGET_MS);
    expect(DEFAULT_TIME_BUDGET_MS).toBeLessThan(DEFAULT_CLAIM_TIMEOUT_MS);
  });
});

describe("when a Board fails", () => {
  // One company's Board being down costs the user that company's roles and
  // nothing else — including the Boards queued behind it in the same batch.
  it("fetches the rest of the run anyway", async () => {
    await workingBoard("acme", 100);
    await unreachableBoard("globex");
    await workingBoard("initech", 300);
    const runId = await startFetchRun();

    const result = await runFetchBatch();

    expect(result).toEqual({ succeeded: 2, failed: 1, remaining: 0 });
    const companies = (await listPostings()).map((posting) => posting.company);
    expect(companies.sort()).toEqual(["acme", "initech"]);
    const run = await readFetchRun(runId);
    expect(taskFor(run, "globex").status).toBe("failed");
    expect(taskFor(run, "acme").status).toBe("succeeded");
  });

  it("records why, so a dead Board can be found and disabled", async () => {
    await unreachableBoard("globex");
    const runId = await startFetchRun();

    await runFetchBatch();

    const failure = taskFor(await readFetchRun(runId), "globex");
    expect(failure.error).toMatch(/globex/);
    expect(failure.error).toMatch(/404/);
  });

  // ADR 0004's dangerous case: the request returned 200 and parsed as JSON, and
  // only the shape was wrong. It must be recorded as a failure, because
  // expiry (#7) reads a succeeded task as evidence that a Posting is gone.
  it("records a response it cannot understand as a failure, not an empty Board", async () => {
    await addBoard({ source: "greenhouse", slug: "acme" });
    boardReturns("acme", [{ id: 100, content: "no title here" }]);
    const runId = await startFetchRun();

    const result = await runFetchBatch();

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    const failure = taskFor(await readFetchRun(runId), "acme");
    expect(failure.status).toBe("failed");
    expect(failure.error).toMatch(/title/);
    expect(await listPostings()).toEqual([]);
  });

  // Whoever has to fix a dead Board (#17) needs to know whether it refused or
  // simply never spoke; those call for different things.
  it("records a Board that never answered as having timed out", async () => {
    await addBoard({ source: "greenhouse", slug: "globex" });
    boardNeverAnswers("globex");
    const runId = await startFetchRun();

    await runFetchBatch({ boardTimeoutMs: 50 });

    const failure = taskFor(await readFetchRun(runId), "globex");
    expect(failure.status).toBe("failed");
    expect(failure.error).toMatch(/globex/);
    expect(failure.error).toMatch(/did not answer/);
  });

  it("closes a run whose Boards all failed", async () => {
    await unreachableBoard("globex");
    const runId = await startFetchRun();

    await runFetchBatch();

    expect((await readFetchRun(runId)).finishedAt).toBeInstanceOf(Date);
  });
});

/**
 * A worker killed mid-fetch — the platform stopping an invocation that ran out
 * of time — which is the case the queue has to survive without anyone noticing
 * it happened.
 */
describe("when a worker is killed mid-batch", () => {
  it("offers its task to a later invocation once its claim goes stale", async () => {
    await addBoard({ source: "greenhouse", slug: "acme" });
    const reached = deferred<void>();
    const held = deferred<Response>();
    server.use(
      http.get(greenhouseBoardUrl("acme"), () => {
        reached.resolve();
        return held.promise;
      }),
    );
    const runId = await startFetchRun();

    // Never returns: this invocation is gone as far as anyone else can tell.
    const killed = runFetchBatch().catch(() => undefined);
    await reached.promise;

    // The Board itself is fine, so whoever picks the task up next succeeds.
    boardReturns("acme", [greenhouseJob({ id: 100, company_name: "acme" })]);
    const result = await runFetchBatch({ claimTimeoutMs: 0 });

    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 0 });
    const run = await readFetchRun(runId);
    expect(taskFor(run, "acme").status).toBe("succeeded");
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(await listPostings()).toHaveLength(1);

    // The killed invocation coming back to life must not report on work that
    // is no longer its own: its Board answers, badly, and it says nothing.
    held.resolve(HttpResponse.json({ error: "Gateway timeout" }, { status: 504 }));
    await killed;

    const afterwards = taskFor(await readFetchRun(runId), "acme");
    expect(afterwards.status).toBe("succeeded");
    expect(afterwards.error).toBeNull();
  });
});
