import { describe, expect, it } from "vitest";
import { listPostings, probeBoard } from "@/operations";
import {
  boardAnswersWithTheWrongShape,
  boardNeverAnswers,
  boardRefuses,
  boardReturns,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";

/** A candidate Slug, as discovery hands one over: an address and nothing else. */
const candidate = { source: "greenhouse", slug: "acme" } as const;

/**
 * Probing a Slug nobody has promoted yet.
 *
 * Discovery harvests far more Slugs than are worth sweeping, so the question a
 * probe answers is whether a candidate is worth a human's attention — and it
 * has to answer it without the candidate's jobs leaking into the shared Corpus.
 */
describe("probing a candidate Board", () => {
  it("reports how many Postings the Board returned", async () => {
    boardReturns("acme", [
      greenhouseJob({ id: 100 }),
      greenhouseJob({ id: 200 }),
      greenhouseJob({ id: 300 }),
    ]);

    expect(await probeBoard(candidate)).toEqual({
      source: "greenhouse",
      slug: "acme",
      postings: 3,
      error: null,
    });
  });

  // The constraint the whole operation exists under. A candidate has no Board
  // row, so its Postings have nothing to reference — and more to the point,
  // they are not the User's to see until someone promotes the Board.
  it("writes nothing to the Corpus", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100 })]);

    await probeBoard(candidate);

    expect(await listPostings()).toEqual([]);
  });

  // A probe run covers hundreds of candidates and roughly one in six is dead.
  // Throwing would end the run on the first of them.
  it.each([
    ["refused to answer", boardRefuses],
    ["never answered", boardNeverAnswers],
    ["answered with a shape the adapter cannot understand", boardAnswersWithTheWrongShape],
  ])("reports a Board that %s rather than throwing", async (_case, breakBoard) => {
    breakBoard("acme");

    const probe = await probeBoard(candidate, { timeoutMs: 50 });

    expect(probe.error).toEqual(expect.stringContaining("acme"));
    expect(probe.postings).toBe(0);
  });

  // Not the same thing as dead, and the difference is what a human promoting
  // Boards needs: an empty Board is a real company between hires, and worth
  // keeping. A dead Slug is not.
  it("tells a live but empty Board apart from a dead one", async () => {
    boardReturns("acme", []);

    const empty = await probeBoard(candidate);

    expect(empty).toMatchObject({ postings: 0, error: null });
  });
});
