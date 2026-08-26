import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addBoard,
  fetchBoard,
  listPostings,
  type Board,
} from "@/operations";
import {
  greenhouseBoardHandler,
  greenhouseBoardUrl,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";
import { server } from "@/test/msw";

/**
 * The Board under test, in the curated set before each test.
 *
 * A Posting records which Board published it by reference, so a Fetch happens
 * against a Board the application knows about rather than a bare Slug.
 */
let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** Declares what the Greenhouse Board returns for the next Fetch of it. */
function boardReturns(
  slug: string,
  jobs: Array<Record<string, unknown>>,
): void {
  server.use(greenhouseBoardHandler(slug, jobs));
}

/**
 * The first pass through ingestion: one Greenhouse Board into the Corpus.
 *
 * Tested at the primary seam — a real Fetch against a real database, with MSW
 * supplying the source response — so one assertion covers the adapter, the
 * Source Key upsert, and persistence together.
 */
describe("fetching a Greenhouse Board", () => {
  it("stores the Postings the Board returned", async () => {
    boardReturns("acme", [
      greenhouseJob({
        id: 100,
        title: "Staff Engineer, Infrastructure",
        company_name: "Acme",
        location: { name: "Hybrid - London" },
        absolute_url: "https://job-boards.greenhouse.io/acme/jobs/100",
        first_published: "2026-08-06T12:50:10-04:00",
        content: "&lt;p&gt;Build the thing.&lt;/p&gt;",
      }),
    ]);

    await fetchBoard(acme);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      source: "greenhouse",
      sourceId: "100",
      boardId: acme.id,
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      location: "Hybrid - London",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/100",
      postedAt: new Date("2026-08-06T12:50:10-04:00"),
    });
  });

  it("stores every Posting on the Board", async () => {
    boardReturns("acme", [
      greenhouseJob({ id: 100, title: "Staff Engineer, Infrastructure" }),
      greenhouseJob({ id: 200, title: "Product Designer" }),
      greenhouseJob({ id: 300, title: "Account Executive" }),
    ]);

    await fetchBoard(acme);

    const titles = (await listPostings()).map((posting) => posting.title);
    expect(titles.sort()).toEqual([
      "Account Executive",
      "Product Designer",
      "Staff Engineer, Infrastructure",
    ]);
  });

  // Greenhouse escapes the description it returns, so storing `content`
  // verbatim would put `&lt;p&gt;` in front of the reader.
  it("stores the description as HTML rather than as escaped text", async () => {
    boardReturns("acme", [
      greenhouseJob({
        content:
          "&lt;p&gt;Ship it.&lt;/p&gt;&lt;p&gt;R&amp;amp;D at today&#39;s pace&lt;/p&gt;",
      }),
    ]);

    await fetchBoard(acme);

    // Decoded exactly once: Greenhouse escaped the `&` of an `&amp;` that was
    // already in the company's HTML, and decoding twice would corrupt it.
    const [posting] = await listPostings();
    expect(posting.description).toBe(
      "<p>Ship it.</p><p>R&amp;D at today's pace</p>",
    );
  });

  it("leaves character references it does not recognise as they came", async () => {
    boardReturns("acme", [
      greenhouseJob({
        content: "&lt;p&gt;A &#x2764; &notanentity; &#1114113;&lt;/p&gt;",
      }),
    ]);

    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.description).toBe("<p>A ❤ &notanentity; &#1114113;</p>");
  });

  // A date the Source did not publish is unknown, not the epoch — and not the
  // date the company last edited the job, which `updated_at` holds.
  it("stores no posted date where the Board published none", async () => {
    boardReturns("acme", [
      greenhouseJob({
        first_published: null,
        updated_at: "2026-08-18T18:06:19-04:00",
      }),
    ]);

    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.postedAt).toBeNull();
  });

  it("updates a Posting it has seen before rather than duplicating it", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100, title: "Staff Engineer" })]);
    await fetchBoard(acme);
    const [first] = await listPostings();

    boardReturns("acme", [
      greenhouseJob({ id: 100, title: "Staff Engineer, Platform" }),
    ]);
    await fetchBoard(acme);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    expect(postings[0].id).toBe(first.id);
    expect(postings[0].title).toBe("Staff Engineer, Platform");
  });

  // The date the Corpus first met a Posting survives every later Fetch, while
  // the date it last saw it moves. #7 reads the second as presence.
  it("keeps when it first saw a Posting and records when it last saw it", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100 })]);
    await fetchBoard(acme);
    const [first] = await listPostings();

    boardReturns("acme", [greenhouseJob({ id: 100 })]);
    await fetchBoard(acme);

    const [refetched] = await listPostings();
    expect(refetched.firstSeenAt).toEqual(first.firstSeenAt);
    expect(refetched.lastSeenAt.getTime()).toBeGreaterThan(
      first.lastSeenAt.getTime(),
    );
  });

  it("reflects a description the company edited upstream", async () => {
    boardReturns("acme", [
      greenhouseJob({ id: 100, content: "&lt;p&gt;Build the thing.&lt;/p&gt;" }),
    ]);
    await fetchBoard(acme);

    boardReturns("acme", [
      greenhouseJob({
        id: 100,
        content: "&lt;p&gt;Build the thing. Now with on-call.&lt;/p&gt;",
      }),
    ]);
    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.description).toBe(
      "<p>Build the thing. Now with on-call.</p>",
    );
  });

  // #18 re-runs its seed by hand, and a Board arriving twice must stay the
  // same Board: a new row would leave every Posting already fetched pointing
  // at a Board nothing sweeps any more, and #7 would never expire them.
  it("keeps a Board's identity when the same Board is added again", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100 })]);
    await fetchBoard(acme);

    const readded = await addBoard({ source: "greenhouse", slug: "acme" });

    expect(readded.id).toBe(acme.id);
    const [posting] = await listPostings();
    expect(posting.boardId).toBe(readded.id);
  });

  // Fetching one Board is not allowed to disturb another's Postings; #6 runs
  // hundreds of these in a row.
  it("leaves other Boards' Postings alone", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100, company_name: "Acme" })]);
    boardReturns("globex", [
      greenhouseJob({ id: 200, company_name: "Globex" }),
    ]);

    await fetchBoard(acme);
    await fetchBoard(await addBoard({ source: "greenhouse", slug: "globex" }));

    const companies = (await listPostings()).map((posting) => posting.company);
    expect(companies.sort()).toEqual(["Acme", "Globex"]);
  });

  describe("validating the source response", () => {
    // The lenient-outbound rule: Sources add fields without notice, and a
    // rejected response would take a whole Board down over a field nobody
    // wanted.
    it("ignores a field the Source added since the adapter was written", async () => {
      server.use(
        greenhouseBoardHandler(
          "acme",
          [
            greenhouseJob({
              id: 100,
              title: "Staff Engineer",
              pay_transparency_disclosure: { min: 180000, max: 220000 },
              data_compliance: [{ type: "gdpr", requires_consent: false }],
            }),
          ],
          // Unknown fields on the envelope are stripped too, not just on the
          // jobs inside it.
          { meta: { total: 1, next_cursor: "abc" }, warnings: ["deprecated"] },
        ),
      );

      await fetchBoard(acme);

      const postings = await listPostings();
      expect(postings).toHaveLength(1);
      expect(postings[0].title).toBe("Staff Engineer");
      expect(postings[0]).not.toHaveProperty("pay_transparency_disclosure");
    });

    // The other half of the rule: a field the adapter depends on going missing
    // is a broken Board, not an empty one. #7 leans on this failing rather
    // than falling through to "the Board returned nothing".
    it("fails the Fetch when a field it depends on is missing", async () => {
      boardReturns("acme", [
        { id: 100, content: "&lt;p&gt;No title here.&lt;/p&gt;" },
      ]);

      await expect(fetchBoard(acme)).rejects.toThrow(/acme/);
      expect(await listPostings()).toEqual([]);
    });

    it("fails the Fetch when the Board could not be read at all", async () => {
      server.use(
        http.get(greenhouseBoardUrl("acme"), () =>
          HttpResponse.json({ error: "Not found" }, { status: 404 }),
        ),
      );

      await expect(fetchBoard(acme)).rejects.toThrow(/404/);
      expect(await listPostings()).toEqual([]);
    });

    // ADR 0004's invariant seen from this end: a Fetch that failed is not
    // evidence about any Posting, so it must leave the Corpus exactly as it
    // found it — `last_seen_at` included, since #7 reads that as presence.
    // Asserting on an empty Corpus alone would not catch a write that ran
    // before the failure.
    it.each([
      [
        "a response it cannot understand",
        () => boardReturns("acme", [{ id: 100, content: "no title" }]),
      ],
      [
        "a Board that could not be read",
        () =>
          server.use(
            http.get(greenhouseBoardUrl("acme"), () =>
              HttpResponse.json({ error: "Not found" }, { status: 404 }),
            ),
          ),
      ],
    ])("leaves known Postings untouched after %s", async (_case, breakBoard) => {
      boardReturns("acme", [greenhouseJob({ id: 100, title: "Staff Engineer" })]);
      await fetchBoard(acme);
      const before = await listPostings();

      breakBoard();
      await expect(fetchBoard(acme)).rejects.toThrow();

      expect(await listPostings()).toEqual(before);
    });
  });
});
