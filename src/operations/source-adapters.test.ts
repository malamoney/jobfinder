import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user, type SourceName } from "@/db/schema";
import {
  addBoard,
  fetchBoard,
  listPostings,
  readDashboard,
  saveCriteria,
  type Board,
} from "@/operations";
import {
  ashbyBoardHandler,
  ashbyBoardRefuses,
  ashbyBoardReturns,
  ashbyCompensation,
  ashbyJob,
} from "@/test/fixtures/ashby";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import {
  leverBoardRefuses,
  leverBoardReturns,
  leverPosting,
} from "@/test/fixtures/lever";
import {
  recruiteeBoardRefuses,
  recruiteeBoardReturns,
  recruiteeOffer,
} from "@/test/fixtures/recruitee";
import {
  workableBoardRefuses,
  workableBoardReturns,
  workableJob,
} from "@/test/fixtures/workable";
import { server } from "@/test/msw";

/**
 * The four ATS Sources added in #14, each fetched for real.
 *
 * Tested at the primary seam like Greenhouse before them — a real Fetch against
 * a real database, with MSW supplying the Source response — so one assertion
 * covers the adapter, the Source Key upsert, and persistence together. What is
 * asserted per Source is what that Source does differently; the rules every
 * adapter shares are asserted once, over all of them.
 */

/** A job with one of its fields taken away, as a broken Board would send it. */
function without(
  job: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const broken = { ...job };
  delete broken[field];
  return broken;
}

/**
 * Fields no adapter has ever heard of, in the shape a Source adds them: a
 * nested object and a list, either of which would fail a strict parse.
 */
const FIELDS_NOBODY_ASKED_FOR = {
  pay_transparency_disclosure: { min: 180_000, max: 220_000 },
  data_compliance: [{ type: "gdpr", requires_consent: false }],
};

/** One Source, and how a test declares what its Board returns. */
type SourceUnderTest = {
  source: SourceName;
  /** A Board returning one well-formed job. */
  returnsOneJob: (slug: string) => void;
  /** A Board whose job carries fields written after the adapter was. */
  returnsAJobWithNewFields: (slug: string) => void;
  /** A Board answering with a job missing a field the adapter depends on. */
  returnsABrokenJob: (slug: string) => void;
  /** A Board that answers, but refuses to serve itself. */
  refuses: (slug: string) => void;
};

const SOURCES: SourceUnderTest[] = [
  {
    source: "lever",
    returnsOneJob: (slug) => leverBoardReturns(slug, [leverPosting()]),
    returnsAJobWithNewFields: (slug) =>
      leverBoardReturns(slug, [leverPosting(FIELDS_NOBODY_ASKED_FOR)]),
    returnsABrokenJob: (slug) =>
      leverBoardReturns(slug, [without(leverPosting(), "text")]),
    refuses: leverBoardRefuses,
  },
  {
    source: "ashby",
    returnsOneJob: (slug) => ashbyBoardReturns(slug, [ashbyJob()]),
    returnsAJobWithNewFields: (slug) =>
      ashbyBoardReturns(slug, [ashbyJob(FIELDS_NOBODY_ASKED_FOR)]),
    returnsABrokenJob: (slug) =>
      ashbyBoardReturns(slug, [without(ashbyJob(), "title")]),
    refuses: ashbyBoardRefuses,
  },
  {
    source: "workable",
    returnsOneJob: (slug) => workableBoardReturns(slug, [workableJob()]),
    returnsAJobWithNewFields: (slug) =>
      workableBoardReturns(slug, [workableJob(FIELDS_NOBODY_ASKED_FOR)]),
    returnsABrokenJob: (slug) =>
      workableBoardReturns(slug, [without(workableJob(), "description")]),
    refuses: workableBoardRefuses,
  },
  {
    source: "recruitee",
    returnsOneJob: (slug) => recruiteeBoardReturns(slug, [recruiteeOffer()]),
    returnsAJobWithNewFields: (slug) =>
      recruiteeBoardReturns(slug, [recruiteeOffer(FIELDS_NOBODY_ASKED_FOR)]),
    returnsABrokenJob: (slug) =>
      recruiteeBoardReturns(slug, [without(recruiteeOffer(), "company_name")]),
    refuses: recruiteeBoardRefuses,
  },
];

/** Puts a Board of the given Source into the curated set. */
function givenABoard(source: SourceName, slug = "acme"): Promise<Board> {
  return addBoard({ source, slug });
}

describe.each(SOURCES)(
  "every Source's adapter ($source)",
  ({
    source,
    returnsOneJob,
    returnsAJobWithNewFields,
    returnsABrokenJob,
    refuses,
  }) => {
    it("stores what the Board returned, against its own Source", async () => {
      const board = await givenABoard(source);
      returnsOneJob("acme");

      await fetchBoard(board);

      const [posting] = await listPostings();
      expect(posting).toMatchObject({
        source,
        boardId: board.id,
        title: "Staff Engineer, Infrastructure",
      });
      expect(posting.sourceId).not.toBe("");
      expect(posting.description).not.toBe("");
      expect(posting.applyUrl).toMatch(/^https:\/\//);
    });

    // The lenient-inbound rule: Sources add fields without notice, and a
    // rejected response would take a whole Board down over a field nobody
    // wanted.
    it("ignores a field the Source added since the adapter was written", async () => {
      const board = await givenABoard(source);
      returnsAJobWithNewFields("acme");

      await fetchBoard(board);

      const postings = await listPostings();
      expect(postings).toHaveLength(1);
      expect(postings[0].title).toBe("Staff Engineer, Infrastructure");
      expect(postings[0]).not.toHaveProperty("pay_transparency_disclosure");
    });

    // The other half of the rule: a field the adapter depends on going missing
    // is a broken Board, not an empty one. #7 leans on this failing rather than
    // falling through to "the Board returned nothing", which ADR 0004 would
    // read as every Posting on the Board having expired.
    it("fails the Fetch when a field it depends on is missing", async () => {
      const board = await givenABoard(source);
      returnsABrokenJob("acme");

      await expect(fetchBoard(board)).rejects.toThrow(/acme/);
      expect(await listPostings()).toEqual([]);
    });

    it("fails the Fetch when the Board could not be read at all", async () => {
      const board = await givenABoard(source);
      refuses("acme");

      await expect(fetchBoard(board)).rejects.toThrow(/404/);
      expect(await listPostings()).toEqual([]);
    });

    // ADR 0004's invariant: a Fetch that failed is not evidence about any
    // Posting, so it must leave the Corpus exactly as it found it.
    it("leaves known Postings untouched after a Fetch it could not read", async () => {
      const board = await givenABoard(source);
      returnsOneJob("acme");
      await fetchBoard(board);
      const before = await listPostings();

      returnsABrokenJob("acme");
      await expect(fetchBoard(board)).rejects.toThrow();

      expect(await listPostings()).toEqual(before);
    });

    it("updates a Posting it has seen before rather than duplicating it", async () => {
      const board = await givenABoard(source);
      returnsOneJob("acme");
      await fetchBoard(board);
      const [first] = await listPostings();

      returnsOneJob("acme");
      await fetchBoard(board);

      const postings = await listPostings();
      expect(postings).toHaveLength(1);
      expect(postings[0].id).toBe(first.id);
    });
  },
);

describe("fetching a Lever Board", () => {
  let acme: Board;

  beforeEach(async () => {
    acme = await givenABoard("lever");
  });

  it("stores the Postings the Board returned", async () => {
    leverBoardReturns("acme", [
      leverPosting({
        id: "33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
        text: "Staff Engineer, Infrastructure",
        categories: { location: "Boston, MA", allLocations: ["Boston, MA"] },
        workplaceType: "hybrid",
        createdAt: 1_775_000_000_000,
        hostedUrl: "https://jobs.lever.co/acme/33538a2f",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0]).toMatchObject({
      source: "lever",
      sourceId: "33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
      title: "Staff Engineer, Infrastructure",
      location: "Hybrid - Boston, MA",
      applyUrl: "https://jobs.lever.co/acme/33538a2f",
      postedAt: new Date(1_775_000_000_000),
    });
  });

  // Lever publishes no company name anywhere in the response, and a Posting
  // must carry one: it is displayed, and it is a third of the Dedup Key.
  it("names the company after the Board, since Lever does not name it", async () => {
    const globex = await givenABoard("lever", "globex-industries");
    leverBoardReturns("globex-industries", [leverPosting()]);

    await fetchBoard(globex);

    expect((await listPostings())[0].company).toBe("Globex Industries");
  });

  // A Lever description arrives in pieces, and the qualifications are the piece
  // a keyword match is most likely to be looking for.
  it("stores the whole description, not only its opening", async () => {
    leverBoardReturns("acme", [
      leverPosting({
        description: "<div>Build the thing.</div>",
        lists: [
          { text: "Requirements", content: "<li>Postgres</li>" },
          { text: "Benefits", content: "<li>Lunch</li>" },
        ],
        additional: "<div>Acme is an equal opportunity employer.</div>",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].description).toBe(
      "<div>Build the thing.</div>" +
        "<h3>Requirements</h3><ul><li>Postgres</li></ul>" +
        "<h3>Benefits</h3><ul><li>Lunch</li></ul>" +
        "<div>Acme is an equal opportunity employer.</div>",
    );
  });

  // Keeping only the first would quietly lose the role for everyone outside
  // that city, and they would never find out.
  it("names every location a posting is open in", async () => {
    leverBoardReturns("acme", [
      leverPosting({
        workplaceType: "onsite",
        categories: {
          location: "Boston, MA",
          allLocations: ["Boston, MA", "Austin, TX"],
        },
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].location).toBe(
      "Onsite - Boston, MA / Austin, TX",
    );
  });

  // Lever sends the list empty rather than absent, so a fallback that only
  // caught null would read "no locations" and throw away the primary one
  // sitting beside it.
  it("keeps the primary location when the list of them is empty", async () => {
    leverBoardReturns("acme", [
      leverPosting({
        workplaceType: "onsite",
        categories: { location: "Boston, MA", allLocations: [] },
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].location).toBe("Onsite - Boston, MA");
  });

  it("prefers the salary Lever states over the one its description implies", async () => {
    leverBoardReturns("acme", [
      leverPosting({
        description: "<div>Comparable roles pay a salary of $95,000.</div>",
        salaryRange: {
          min: 180_000,
          max: 220_000,
          currency: "USD",
          interval: "per-year-salary",
        },
      }),
    ]);

    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.salaryMin).toBe(180_000);
    expect(posting.salaryMax).toBe(220_000);
    expect(posting.salaryPeriod).toBe("year");
  });
});

describe("fetching an Ashby Board", () => {
  let acme: Board;

  beforeEach(async () => {
    acme = await givenABoard("ashby");
  });

  it("stores the Postings the Board returned", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({
        id: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
        title: "Staff Engineer, Infrastructure",
        location: "Remote - US",
        workplaceType: "Remote",
        publishedAt: "2026-03-04T14:29:08.532+00:00",
        jobUrl: "https://jobs.ashbyhq.com/acme/7458d4e9",
        descriptionHtml: "<p>Build the thing.</p>",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0]).toMatchObject({
      source: "ashby",
      sourceId: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      description: "<p>Build the thing.</p>",
      // Already said in the location Ashby publishes, so nothing is prefixed.
      location: "Remote - US",
      applyUrl: "https://jobs.ashbyhq.com/acme/7458d4e9",
      postedAt: new Date("2026-03-04T14:29:08.532+00:00"),
    });
  });

  // Most Ashby jobs carry these — 57 of the 67 on the Board sampled live — so
  // dropping them would lose where most of this Source's roles are open.
  it("names the other locations a job is open in", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({
        location: "Austin, TX",
        workplaceType: "Hybrid",
        secondaryLocations: [
          { location: "Denver, CO" },
          { location: "Seattle, WA" },
        ],
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].location).toBe(
      "Hybrid - Austin, TX / Denver, CO / Seattle, WA",
    );
  });

  it("stores the salary Ashby publishes as data", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({
        compensation: ashbyCompensation({
          minValue: 180_000,
          maxValue: 220_000,
        }),
      }),
    ]);

    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.salaryMin).toBe(180_000);
    expect(posting.salaryMax).toBe(220_000);
    expect(posting.salaryPeriod).toBe("year");
  });

  it("reads an hourly rate in its own unit", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({
        compensation: ashbyCompensation({
          interval: "1 HOUR",
          minValue: 85,
          maxValue: 110,
        }),
      }),
    ]);

    await fetchBoard(acme);

    expect(await listPostings()).toMatchObject([
      { salaryMin: 85, salaryMax: 110, salaryPeriod: "hour" },
    ]);
  });

  // A wrong number is worse than no number: the floor a User states is in
  // dollars, and nothing here converts currencies. Extraction still gets its
  // turn at the description.
  it("does not read pay stated in another currency", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({
        compensation: ashbyCompensation({
          currencyCode: "EUR",
          minValue: 110_000,
          maxValue: 185_000,
        }),
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].salaryMin).toBeNull();
  });

  // The equity component is a min/max pair like the salary is, and only its
  // type says which is pay.
  it("does not read an equity grant as pay", async () => {
    ashbyBoardReturns("acme", [ashbyJob({ compensation: ashbyCompensation(null) })]);

    await fetchBoard(acme);

    expect((await listPostings())[0].salaryMin).toBeNull();
  });

  it("leaves out a job the company has unlisted", async () => {
    ashbyBoardReturns("acme", [
      ashbyJob({ id: "a", title: "Staff Engineer", isListed: true }),
      ashbyJob({ id: "b", title: "Product Designer", isListed: false }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings()).map((posting) => posting.title)).toEqual([
      "Staff Engineer",
    ]);
  });

  it("ignores unknown fields on the envelope as well as on the jobs", async () => {
    server.use(
      ashbyBoardHandler(
        "acme",
        [ashbyJob({ compensationTierSummary: "$180K – $220K" })],
        { apiVersion: "2", warnings: ["deprecated"] },
      ),
    );

    await fetchBoard(acme);

    expect(await listPostings()).toHaveLength(1);
  });
});

describe("fetching a Workable Board", () => {
  let acme: Board;

  beforeEach(async () => {
    acme = await givenABoard("workable");
  });

  it("stores the Postings the Board returned", async () => {
    workableBoardReturns("acme", [
      workableJob({
        shortcode: "D26AEB4351",
        title: "Staff Engineer, Infrastructure",
        telecommuting: false,
        city: "Atlanta",
        state: "Georgia",
        country: "United States",
        published_on: "2026-06-17",
        url: "https://apply.workable.com/j/D26AEB4351",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0]).toMatchObject({
      source: "workable",
      sourceId: "D26AEB4351",
      // The account name off the envelope, the only place Workable says it.
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      location: "Atlanta, Georgia, United States",
      applyUrl: "https://apply.workable.com/j/D26AEB4351",
      postedAt: new Date("2026-06-17T00:00:00Z"),
    });
  });

  // The quirk this adapter exists to absorb: Workable publishes one entry per
  // job per location, and an upsert cannot touch one row twice — so left alone
  // a single two-city job would fail the Board's whole Fetch, every night.
  it("stores one Posting for a job the Board lists once per location", async () => {
    workableBoardReturns("acme", [
      workableJob({
        shortcode: "FC2EB548ED",
        title: "Sales Development Representative",
        telecommuting: false,
        city: "Atlanta",
        state: "Georgia",
        country: "United States",
      }),
      workableJob({
        shortcode: "FC2EB548ED",
        title: "Sales Development Representative",
        telecommuting: false,
        city: "Florida City",
        state: "Florida",
        country: "United States",
      }),
    ]);

    await fetchBoard(acme);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    // Both places named, so the role does not quietly stop existing for
    // everyone outside the first one.
    expect(postings[0].location).toBe(
      "Atlanta, Georgia, United States / Florida City, Florida, United States",
    );
  });

  // Workable states remote work as a flag beside the place rather than in it,
  // and an Arrangement the Corpus never sees is an Arrangement no filter can
  // act on.
  it("says in the location that a job Workable flags is remote", async () => {
    workableBoardReturns("acme", [
      workableJob({
        telecommuting: true,
        city: "Austin",
        state: "Texas",
        country: "United States",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].location).toBe(
      "Remote - Austin, Texas, United States",
    );
  });
});

describe("fetching a Recruitee Board", () => {
  let acme: Board;

  beforeEach(async () => {
    acme = await givenABoard("recruitee");
  });

  it("stores the Postings the Board returned", async () => {
    recruiteeBoardReturns("acme", [
      recruiteeOffer({
        id: 2_721_461,
        title: "Staff Engineer, Infrastructure",
        company_name: "Acme",
        location: "Austin, Texas, United States",
        remote: false,
        hybrid: true,
        careers_url: "https://jobs.acme.com/o/staff-engineer",
        published_at: "2026-08-25 11:59:25 UTC",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0]).toMatchObject({
      source: "recruitee",
      // A number upstream, a string in the Corpus, like every other Source Key.
      sourceId: "2721461",
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      location: "Hybrid - Austin, Texas, United States",
      applyUrl: "https://jobs.acme.com/o/staff-engineer",
      // Recruitee dates are not ISO 8601; parsed rather than dropped.
      postedAt: new Date("2026-08-25T11:59:25Z"),
    });
  });

  it("stores the requirements as part of the description", async () => {
    recruiteeBoardReturns("acme", [
      recruiteeOffer({
        description: "<p>Build the thing.</p>",
        requirements: "<ul><li>Postgres</li></ul>",
      }),
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].description).toBe(
      "<p>Build the thing.</p><ul><li>Postgres</li></ul>",
    );
  });

  it("stores the salary Recruitee publishes as data", async () => {
    recruiteeBoardReturns("acme", [
      recruiteeOffer({
        salary: { min: "72", max: null, period: "hour", currency: "USD" },
      }),
    ]);

    await fetchBoard(acme);

    // One stated bound stands for both: that is what a Posting stating only a
    // minimum means.
    expect(await listPostings()).toMatchObject([
      { salaryMin: 72, salaryMax: 72, salaryPeriod: "hour" },
    ]);
  });

  // Recruitee addresses a Board by subdomain, so a Slug carrying a `/` or a `.`
  // would point the request at another server entirely — and discovery probes
  // Slugs harvested from the open web (#18).
  it("refuses a Slug that is not a hostname it can address", async () => {
    const hostile = await givenABoard("recruitee", "acme.example.com/api");

    await expect(fetchBoard(hostile)).rejects.toThrow(/not a Slug/);
    expect(await listPostings()).toEqual([]);
  });
});

describe("one Source going wrong", () => {
  // The isolation ADR 0003 asks for: five Sources change shape independently,
  // and a sweep runs hundreds of Boards across all of them.
  it("does not affect a Fetch of any other Source", async () => {
    const boards = {
      greenhouse: await givenABoard("greenhouse", "acme-gh"),
      lever: await givenABoard("lever", "acme-lever"),
      ashby: await givenABoard("ashby", "acme-ashby"),
      workable: await givenABoard("workable", "acme-workable"),
      recruitee: await givenABoard("recruitee", "acme-recruitee"),
    };

    // Lever answers with something no adapter could understand; the other four
    // answer normally.
    leverBoardReturns("acme-lever", [{ id: "nothing else" }]);
    boardReturns("acme-gh", [greenhouseJob({ id: 100 })]);
    ashbyBoardReturns("acme-ashby", [ashbyJob({ id: "a" })]);
    workableBoardReturns("acme-workable", [workableJob({ shortcode: "W1" })]);
    recruiteeBoardReturns("acme-recruitee", [recruiteeOffer({ id: 1 })]);

    await expect(fetchBoard(boards.lever)).rejects.toThrow(/acme-lever/);
    await fetchBoard(boards.greenhouse);
    await fetchBoard(boards.ashby);
    await fetchBoard(boards.workable);
    await fetchBoard(boards.recruitee);

    expect((await listPostings()).map((posting) => posting.source).sort()).toEqual([
      "ashby",
      "greenhouse",
      "recruitee",
      "workable",
    ]);
  });

  // The Source Key is the Source *paired with* the Source's own identifier, so
  // two Sources numbering a job the same are two Postings, not one overwriting
  // the other.
  it("does not collide with another Source using the same identifier", async () => {
    const lever = await givenABoard("lever", "acme-lever");
    const ashby = await givenABoard("ashby", "acme-ashby");
    const shared = "7458d4e9-da2e-47bd-98cb-adfda43d42b2";

    leverBoardReturns("acme-lever", [
      leverPosting({ id: shared, text: "Staff Engineer" }),
    ]);
    ashbyBoardReturns("acme-ashby", [
      ashbyJob({ id: shared, title: "Product Designer" }),
    ]);

    await fetchBoard(lever);
    await fetchBoard(ashby);

    const postings = await listPostings();
    expect(postings).toHaveLength(2);
    expect(postings.map((posting) => posting.title).sort()).toEqual([
      "Product Designer",
      "Staff Engineer",
    ]);
  });
});

describe("a salary a Source published", () => {
  const PASSWORD = "correct-horse-battery-staple";

  /** Signs up a User and hands back their id. */
  async function givenAUser(email = "ada@example.com"): Promise<string> {
    const outcome = await signUp(
      { email, password: PASSWORD },
      new Headers({ host: "localhost:3000" }),
    );
    if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);

    const [row] = await getDb().select().from(user).where(eq(user.email, email));
    return row.id;
  }

  /**
   * Extraction runs inside the matching funnel over the Postings a User's
   * cheap stages let through, so stating Criteria is how a test reaches it.
   */
  async function extractedSalaryOf(userId: string) {
    await saveCriteria(userId, {
      titles: ["Staff Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });
    const [posting] = (await readDashboard(userId)).postings;
    return {
      min: posting.salaryMin,
      max: posting.salaryMax,
      period: posting.salaryPeriod,
    };
  }

  // The reason #14 singles Ashby out: a figure a company typed into a field
  // marked "salary" beats one recognised in prose, and Extraction must not
  // overwrite it when it runs later.
  it("survives the Extraction that runs over the Posting afterwards", async () => {
    const acme = await givenABoard("ashby");
    ashbyBoardReturns("acme", [
      ashbyJob({
        title: "Staff Engineer, Infrastructure",
        descriptionHtml:
          "<p>Our last hire in this role earned a salary of $95,000.</p>",
        compensation: ashbyCompensation({
          minValue: 180_000,
          maxValue: 220_000,
        }),
      }),
    ]);
    await fetchBoard(acme);

    expect(await extractedSalaryOf(await givenAUser())).toEqual({
      min: 180_000,
      max: 220_000,
      period: "year",
    });
  });

  // And the other way round: where the Source published nothing, the
  // description is still read.
  it("leaves the description to Extraction where the Source published none", async () => {
    const acme = await givenABoard("ashby");
    ashbyBoardReturns("acme", [
      ashbyJob({
        title: "Staff Engineer, Infrastructure",
        descriptionHtml: "<p>The base salary range is $170,000 - $195,000.</p>",
      }),
    ]);
    await fetchBoard(acme);

    expect(await extractedSalaryOf(await givenAUser())).toEqual({
      min: 170_000,
      max: 195_000,
      period: "year",
    });
  });
});
