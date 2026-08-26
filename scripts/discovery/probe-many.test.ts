import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { listPostings, type BoardAddress } from "@/operations";
import {
  boardRefuses,
  boardReturns,
  greenhouseBoard,
  greenhouseBoardUrl,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";
import { server } from "@/test/msw";
import { probeCandidates } from "./probe-many";

/** Candidate Slugs, as a harvest hands them over. */
function candidates(...slugs: string[]): BoardAddress[] {
  return slugs.map((slug) => ({ source: "greenhouse" as const, slug }));
}

/** Declares a Board with `count` open roles, under ids that will not collide. */
function boardWith(slug: string, count: number): void {
  boardReturns(
    slug,
    Array.from({ length: count }, (_, index) =>
      greenhouseJob({ id: `${slug}-${index}`, company_name: slug }),
    ),
  );
}

describe("probing a harvest of candidates", () => {
  it("ranks the Boards with the most open roles first", async () => {
    boardWith("acme", 2);
    boardWith("globex", 9);
    boardWith("initech", 5);

    const ranked = await probeCandidates(
      candidates("acme", "globex", "initech"),
    );

    expect(ranked.map((probe) => probe.slug)).toEqual([
      "globex",
      "initech",
      "acme",
    ]);
  });

  // A live Board with nothing open is a real company between hires, and worth
  // keeping. A Slug that cannot be read is not, so it sinks below one.
  it("sinks the Slugs that could not be read below a live but empty Board", async () => {
    boardWith("acme", 3);
    boardReturns("globex", []);
    boardRefuses("initech");

    const ranked = await probeCandidates(
      candidates("initech", "globex", "acme"),
    );

    expect(ranked.map((probe) => probe.slug)).toEqual([
      "acme",
      "globex",
      "initech",
    ]);
    expect(ranked.at(-1)?.error).toEqual(expect.stringContaining("initech"));
  });

  it("probes every candidate it was given", async () => {
    const slugs = Array.from({ length: 20 }, (_, index) => `board-${index}`);
    for (const slug of slugs) boardWith(slug, 1);

    const ranked = await probeCandidates(candidates(...slugs), {
      concurrency: 4,
    });

    expect(ranked.map((probe) => probe.slug).sort()).toEqual([...slugs].sort());
    expect(ranked.every((probe) => probe.error === null)).toBe(true);
  });

  // The difference between reading a public API and hammering it. A harvest
  // runs to thousands of Slugs, so an unbounded fan-out is not an option.
  it("keeps no more than the requested number of probes in flight", async () => {
    const slugs = Array.from({ length: 12 }, (_, index) => `board-${index}`);
    let inFlight = 0;
    let peak = 0;
    for (const slug of slugs) {
      server.use(
        http.get(greenhouseBoardUrl(slug), async () => {
          peak = Math.max(peak, ++inFlight);
          await delay(10);
          inFlight--;
          return HttpResponse.json(greenhouseBoard([greenhouseJob({ id: slug })]));
        }),
      );
    }

    await probeCandidates(candidates(...slugs), { concurrency: 3 });

    expect(peak).toBe(3);
  });

  // Discovery reads; it never writes. A candidate nobody has promoted has not
  // earned a place in the Corpus every User shares.
  it("leaves the Corpus alone", async () => {
    boardWith("acme", 4);

    const [probe] = await probeCandidates(candidates("acme"));

    // The probe succeeding is what rules out a write that was attempted and
    // then swallowed: a candidate has no `boards` row, so an insert would fail
    // its foreign key and surface here as an error.
    expect(probe).toMatchObject({ postings: 4, error: null });
    expect(await listPostings()).toEqual([]);
  });
});
