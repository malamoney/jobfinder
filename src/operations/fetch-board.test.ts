import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { fetchBoard, listPostings } from "@/operations";
import {
  greenhouseBoard,
  greenhouseBoardUrl,
  greenhouseJob,
} from "@/test/fixtures/greenhouse";
import { server } from "@/test/msw";

const ACME = { source: "greenhouse", slug: "acme" } as const;

/** Declares what the Greenhouse Board returns for the next Fetch of it. */
function boardReturns(
  slug: string,
  jobs: Array<Record<string, unknown>>,
): void {
  server.use(
    http.get(greenhouseBoardUrl(slug), () =>
      HttpResponse.json(greenhouseBoard(jobs)),
    ),
  );
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

    await fetchBoard(ACME);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      source: "greenhouse",
      sourceId: "100",
      boardSlug: "acme",
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

    await fetchBoard(ACME);

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

    await fetchBoard(ACME);

    // Decoded exactly once: Greenhouse escaped the `&` of an `&amp;` that was
    // already in the company's HTML, and decoding twice would corrupt it.
    const [posting] = await listPostings();
    expect(posting.description).toBe(
      "<p>Ship it.</p><p>R&amp;D at today's pace</p>",
    );
  });

  it("updates a Posting it has seen before rather than duplicating it", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100, title: "Staff Engineer" })]);
    await fetchBoard(ACME);
    const [first] = await listPostings();

    boardReturns("acme", [
      greenhouseJob({ id: 100, title: "Staff Engineer, Platform" }),
    ]);
    await fetchBoard(ACME);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    expect(postings[0].id).toBe(first.id);
    expect(postings[0].title).toBe("Staff Engineer, Platform");
  });

  it("reflects a description the company edited upstream", async () => {
    boardReturns("acme", [
      greenhouseJob({ id: 100, content: "&lt;p&gt;Build the thing.&lt;/p&gt;" }),
    ]);
    await fetchBoard(ACME);

    boardReturns("acme", [
      greenhouseJob({
        id: 100,
        content: "&lt;p&gt;Build the thing. Now with on-call.&lt;/p&gt;",
      }),
    ]);
    await fetchBoard(ACME);

    const [posting] = await listPostings();
    expect(posting.description).toBe(
      "<p>Build the thing. Now with on-call.</p>",
    );
  });

  // Fetching one Board is not allowed to disturb another's Postings; #6 runs
  // hundreds of these in a row.
  it("leaves other Boards' Postings alone", async () => {
    boardReturns("acme", [greenhouseJob({ id: 100, company_name: "Acme" })]);
    boardReturns("globex", [
      greenhouseJob({ id: 200, company_name: "Globex" }),
    ]);

    await fetchBoard(ACME);
    await fetchBoard({ source: "greenhouse", slug: "globex" });

    const companies = (await listPostings()).map((posting) => posting.company);
    expect(companies.sort()).toEqual(["Acme", "Globex"]);
  });

  describe("validating the source response", () => {
    // The lenient-outbound rule: Sources add fields without notice, and a
    // rejected response would take a whole Board down over a field nobody
    // wanted.
    it("ignores a field the Source added since the adapter was written", async () => {
      boardReturns("acme", [
        greenhouseJob({
          id: 100,
          title: "Staff Engineer",
          pay_transparency_disclosure: { min: 180000, max: 220000 },
          data_compliance: [{ type: "gdpr", requires_consent: false }],
        }),
      ]);

      await fetchBoard(ACME);

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

      await expect(fetchBoard(ACME)).rejects.toThrow(/acme/);
      expect(await listPostings()).toEqual([]);
    });

    it("fails the Fetch when the response is not a Board at all", async () => {
      server.use(
        http.get(greenhouseBoardUrl("acme"), () =>
          HttpResponse.json({ error: "Not found" }, { status: 404 }),
        ),
      );

      await expect(fetchBoard(ACME)).rejects.toThrow(/404/);
      expect(await listPostings()).toEqual([]);
    });
  });
});
