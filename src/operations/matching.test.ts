import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  addBoard,
  fetchBoard,
  listPostings,
  matchAllUsers,
  matchCriteria,
  readDashboard,
  saveCriteria,
  setStatus,
  type Board,
} from "@/operations";
import { getDb } from "@/db";
import { postings, user } from "@/db/schema";
import { normalizeLocation } from "@/postings/location";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import {
  geocoderIsDown,
  geocoderKnows,
  type Coordinate,
} from "@/test/fixtures/nominatim";
import type { CriteriaInput } from "@/criteria/schema";

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

/** A complete, valid statement of Criteria, overridable field by field. */
function statedCriteria(overrides: Partial<CriteriaInput> = {}): CriteriaInput {
  return {
    titles: ["Staff Engineer"],
    keywords: [],
    arrangements: ["full-time", "remote"],
    ...overrides,
  };
}

/** The Board every Posting in these tests is published on. */
let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

/**
 * Puts the given jobs into the Corpus as a Fetch of the Board would, so a
 * matching test declares a Corpus the way an ingestion test declares a Source
 * response.
 */
async function corpusHas(
  jobs: Array<Record<string, unknown>>,
): Promise<void> {
  boardReturns("acme", jobs);
  await fetchBoard(acme);
}

describe("what a User's Criteria surface", () => {
  it("surfaces a Posting whose title contains a stated title", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer, Infrastructure" }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const { postings } = await readDashboard(userId);
    expect(postings.map((posting) => posting.title)).toEqual([
      "Staff Engineer, Infrastructure",
    ]);
  });

  it("leaves out a Posting matching no title or keyword", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer" }),
      greenhouseJob({ id: 2, title: "Account Executive" }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], keywords: ["kubernetes"] }),
    );

    const { postings } = await readDashboard(userId);
    expect(postings.map((posting) => posting.title)).toEqual(["Staff Engineer"]);
  });

  it("matches a title case-insensitively", async () => {
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer" })]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["staff engineer"] }));

    expect((await readDashboard(userId)).postings).toHaveLength(1);
  });

  it("surfaces a Posting a keyword hits in the description that no title would", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Applied Research Scientist",
        content: "&lt;p&gt;You will work in Postgres and Rust every day.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], keywords: ["postgres"] }),
    );

    const { postings } = await readDashboard(userId);
    expect(postings.map((posting) => posting.title)).toEqual([
      "Applied Research Scientist",
    ]);
  });

  it("shows which keywords matched and omits the ones that did not", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        content: "&lt;p&gt;Postgres, and a lot of it. No Kubernetes here.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({
        titles: ["Staff Engineer"],
        keywords: ["postgres", "terraform"],
      }),
    );

    const [posting] = (await readDashboard(userId)).postings;
    expect(posting.matchedKeywords).toEqual(["postgres"]);
  });

  it("shows no matched keywords for a Posting surfaced by its title alone", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        content: "&lt;p&gt;Nothing relevant in here.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], keywords: ["postgres"] }),
    );

    const [posting] = (await readDashboard(userId)).postings;
    expect(posting.matchedKeywords).toEqual([]);
  });

  it("shows a Posting's title, company, location, and posted date", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        company_name: "Acme",
        location: { name: "Remote - US" },
        first_published: "2026-08-06T12:50:10-04:00",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const [posting] = (await readDashboard(userId)).postings;
    expect(posting).toMatchObject({
      title: "Staff Engineer",
      company: "Acme",
      location: "Remote - US",
      postedAt: new Date("2026-08-06T12:50:10-04:00"),
    });
  });

  it("keeps one User's Matches out of another User's", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer" }),
      greenhouseJob({ id: 2, title: "Data Scientist" }),
    ]);
    const ada = await givenAUser("ada@example.com");
    const grace = await givenAUser("grace@example.com");

    await saveCriteria(ada, statedCriteria({ titles: ["Staff Engineer"] }));
    await saveCriteria(grace, statedCriteria({ titles: ["Data Scientist"] }));

    expect((await readDashboard(ada)).postings.map((p) => p.title)).toEqual([
      "Staff Engineer",
    ]);
    expect((await readDashboard(grace)).postings.map((p) => p.title)).toEqual([
      "Data Scientist",
    ]);
  });
});

describe("the unreviewed count", () => {
  it("counts every matched Posting while nothing has been reviewed", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer, Infra" }),
      greenhouseJob({ id: 2, title: "Staff Engineer, Product" }),
      greenhouseJob({ id: 3, title: "Recruiter" }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    expect((await readDashboard(userId)).unreviewedCount).toBe(2);
  });
});

describe("the new-today count", () => {
  /** Comfortably outside the 24-hour "new today" window. */
  const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  it("counts only matched openings first seen in the last 24 hours", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer, Fresh" }),
      greenhouseJob({ id: 2, title: "Staff Engineer, Stale" }),
      greenhouseJob({ id: 3, title: "Recruiter" }),
    ]);
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    // Both Staff Engineer roles match, but one was collected days ago.
    await getDb()
      .update(postings)
      .set({ firstSeenAt: THREE_DAYS_AGO })
      .where(eq(postings.title, "Staff Engineer, Stale"));

    const dashboard = await readDashboard(userId);
    expect(dashboard.matchedCount).toBe(2);
    expect(dashboard.newTodayCount).toBe(1);
  });

  it("counts an opening new only when every matched listing of it is recent", async () => {
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer" })]);
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    await getDb()
      .update(postings)
      .set({ firstSeenAt: THREE_DAYS_AGO })
      .where(eq(postings.title, "Staff Engineer"));

    expect((await readDashboard(userId)).newTodayCount).toBe(0);
  });

  it("leaves out an opening that is already Expired", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer, Live" }),
      greenhouseJob({ id: 2, title: "Staff Engineer, Gone" }),
    ]);
    // Two further successful Fetches without #2 mark it Expired (#7); it stays
    // freshly collected the whole time.
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer, Live" })]);
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer, Live" })]);

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const dashboard = await readDashboard(userId);
    expect(dashboard.matchedCount).toBe(2);
    expect(dashboard.newTodayCount).toBe(1);
  });
});

describe("the review-pipeline counts", () => {
  /** Four matched openings, so each Status can be given one of its own. */
  async function fourMatched(): Promise<{
    userId: string;
    idFor: (sourceId: string) => string;
  }> {
    await corpusHas(
      [1, 2, 3, 4].map((id) =>
        greenhouseJob({ id, title: `Staff Engineer ${id}` }),
      ),
    );
    const corpus = await listPostings();
    const idFor = (sourceId: string) =>
      corpus.find((posting) => posting.sourceId === sourceId)!.id;

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));
    return { userId, idFor };
  }

  it("counts interested, not-interested, and applied openings off Review State", async () => {
    const { userId, idFor } = await fourMatched();

    await setStatus(userId, idFor("1"), "interested");
    await setStatus(userId, idFor("2"), "not_interested");
    await setStatus(userId, idFor("3"), "applied");
    // Posting 4 is left untouched — it stays `new`.

    const dashboard = await readDashboard(userId);
    expect(dashboard.interestedCount).toBe(1);
    expect(dashboard.notInterestedCount).toBe(1);
    expect(dashboard.appliedCount).toBe(1);
    expect(dashboard.unreviewedCount).toBe(1);
  });

  it("holds every count independent of the active filter", async () => {
    const { userId, idFor } = await fourMatched();
    await setStatus(userId, idFor("1"), "interested");
    await setStatus(userId, idFor("2"), "not_interested");
    await setStatus(userId, idFor("3"), "applied");

    for (const filter of [undefined, "all", "applied", "interested"] as const) {
      const dashboard = await readDashboard(userId, filter);
      expect({
        interested: dashboard.interestedCount,
        notInterested: dashboard.notInterestedCount,
        applied: dashboard.appliedCount,
        unreviewed: dashboard.unreviewedCount,
      }).toEqual({
        interested: 1,
        notInterested: 1,
        applied: 1,
        unreviewed: 1,
      });
    }
  });

  it("keeps counting an interested opening after its listing has Expired", async () => {
    const { userId, idFor } = await fourMatched();
    await setStatus(userId, idFor("1"), "interested");

    // Two further successful Fetches without Posting 1 mark it Expired (#7);
    // the User's decision outlives the listing (CONTEXT.md, "Expired").
    await corpusHas(
      [2, 3, 4].map((id) => greenhouseJob({ id, title: `Staff Engineer ${id}` })),
    );
    await corpusHas(
      [2, 3, 4].map((id) => greenhouseJob({ id, title: `Staff Engineer ${id}` })),
    );

    const dashboard = await readDashboard(userId);
    expect(
      dashboard.postings.find((posting) => posting.id === idFor("1"))?.expired,
    ).toBe(true);
    expect(dashboard.interestedCount).toBe(1);
  });
});

describe("re-matching when Criteria change", () => {
  it("re-matches the whole Corpus, including Postings collected earlier", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Applied Research Scientist",
        content: "&lt;p&gt;Heavy Rust and Postgres work.&lt;/p&gt;",
      }),
      greenhouseJob({ id: 2, title: "Staff Engineer" }),
    ]);
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));
    expect((await readDashboard(userId)).postings).toHaveLength(1);

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], keywords: ["postgres"] }),
    );

    const titles = (await readDashboard(userId)).postings.map((p) => p.title);
    expect(titles.sort()).toEqual([
      "Applied Research Scientist",
      "Staff Engineer",
    ]);
  });

  it("drops a Match once Criteria stop selecting its Posting", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer" }),
      greenhouseJob({ id: 2, title: "Product Manager" }),
    ]);
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer", "Product Manager"] }),
    );
    expect((await readDashboard(userId)).postings).toHaveLength(2);

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Staff Engineer"]);
  });

  it("is idempotent — re-running Matching changes nothing", async () => {
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer" })]);
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    await matchCriteria(userId);
    await matchCriteria(userId);

    expect((await readDashboard(userId)).postings).toHaveLength(1);
  });
});

describe("re-matching every User after a Fetch", () => {
  it("surfaces a newly collected Posting on every User's Dashboard", async () => {
    const ada = await givenAUser("ada@example.com");
    const grace = await givenAUser("grace@example.com");
    await saveCriteria(ada, statedCriteria({ titles: ["Engineer"] }));
    await saveCriteria(grace, statedCriteria({ titles: ["Engineer"] }));
    expect((await readDashboard(ada)).postings).toHaveLength(0);

    // A Fetch collects a matching Posting after both Users stated Criteria.
    await corpusHas([greenhouseJob({ id: 1, title: "Platform Engineer" })]);
    await matchAllUsers();

    expect((await readDashboard(ada)).postings.map((p) => p.title)).toEqual([
      "Platform Engineer",
    ]);
    expect((await readDashboard(grace)).postings.map((p) => p.title)).toEqual([
      "Platform Engineer",
    ]);
  });

  it("leaves a signed-up User who has stated no Criteria alone", async () => {
    await givenAUser("nocrit@example.com");
    const ada = await givenAUser("ada@example.com");
    await saveCriteria(ada, statedCriteria({ titles: ["Engineer"] }));
    await corpusHas([greenhouseJob({ id: 1, title: "Platform Engineer" })]);

    await expect(matchAllUsers()).resolves.toBeUndefined();
    expect((await readDashboard(ada)).postings).toHaveLength(1);
  });
});

describe("Expired Postings on the Dashboard", () => {
  it("surfaces a matched Posting the Board stopped returning, flagged Expired", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer, Infra" }),
      greenhouseJob({ id: 2, title: "Staff Engineer, Product" }),
    ]);
    // Two successful Fetches without Posting 2 is what marks it Expired (#7).
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer, Infra" })]);
    await corpusHas([greenhouseJob({ id: 1, title: "Staff Engineer, Infra" })]);

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const dashboard = await readDashboard(userId);
    const byTitle = Object.fromEntries(
      dashboard.postings.map((p) => [p.title, p.expired]),
    );
    expect(byTitle).toEqual({
      "Staff Engineer, Infra": false,
      "Staff Engineer, Product": true,
    });
    // The filled role is still shown, but it is not something to open the app
    // for, so it is left out of the unreviewed count (#33).
    expect(dashboard.unreviewedCount).toBe(1);
  });
});

describe("Extraction over the survivors of the cheap stages", () => {
  it("extracts a Posting a User's title surfaced and leaves the others untouched", async () => {
    await corpusHas([
      greenhouseJob({ id: 1, title: "Staff Engineer" }),
      greenhouseJob({ id: 2, title: "Account Executive" }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    // Extraction is stage three of the funnel: it runs over what the cheap
    // stages let through, never the whole Corpus (#11). The Posting no title
    // matched has never been through it.
    const extracted = Object.fromEntries(
      (await getDb().select().from(postings)).map((row) => [
        row.title,
        row.extractedAt !== null,
      ]),
    );
    expect(extracted).toEqual({
      "Staff Engineer": true,
      "Account Executive": false,
    });
  });

  it("re-extracts a Posting after a re-Fetch rewrote its description", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        content: "&lt;p&gt;Compensation is competitive.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));
    expect((await readDashboard(userId)).postings[0].salaryMax).toBeNull();

    // The company edits the posting to state a band; the next Fetch overwrites
    // the description and clears the derived fields, so the next match run
    // extracts it again.
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        content: "&lt;p&gt;The salary range is $190,000 - $210,000.&lt;/p&gt;",
      }),
    ]);
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    expect((await readDashboard(userId)).postings[0].salaryMax).toBe(210_000);
  });
});

describe("a minimum salary", () => {
  it("excludes a Posting that states a salary below the floor", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer, Data",
        content: "&lt;p&gt;Base salary range: $120,000 - $140,000.&lt;/p&gt;",
      }),
      greenhouseJob({
        id: 2,
        title: "Staff Engineer, Platform",
        content: "&lt;p&gt;Base salary range: $190,000 - $220,000.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], minSalary: 180_000 }),
    );

    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Staff Engineer, Platform"]);
  });

  it("passes a Posting that states no salary at all", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        content: "&lt;p&gt;Compensation is competitive and DOE.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer"], minSalary: 180_000 }),
    );

    expect((await readDashboard(userId)).postings).toHaveLength(1);
  });

  it("annualises an hourly rate before comparing it to the floor", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Contract Engineer, Underpaid",
        content: "&lt;p&gt;This role pays $50/hour.&lt;/p&gt;",
      }),
      greenhouseJob({
        id: 2,
        title: "Contract Engineer, Paid",
        content: "&lt;p&gt;This role pays $95/hour.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Contract Engineer"], minSalary: 150_000 }),
    );

    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Contract Engineer, Paid"]);
  });

  it("carries the extracted salary onto the Dashboard, with null where none was stated", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer, Open",
        content: "&lt;p&gt;The base salary range is $170,000 - $195,000 per year.&lt;/p&gt;",
      }),
      greenhouseJob({
        id: 2,
        title: "Staff Engineer, Quiet",
        content: "&lt;p&gt;We do not discuss pay up front.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const byTitle = Object.fromEntries(
      (await readDashboard(userId)).postings.map((p) => [
        p.title,
        { min: p.salaryMin, max: p.salaryMax, period: p.salaryPeriod },
      ]),
    );
    expect(byTitle).toEqual({
      "Staff Engineer, Open": { min: 170_000, max: 195_000, period: "year" },
      "Staff Engineer, Quiet": { min: null, max: null, period: null },
    });
  });
});

describe("accepted Arrangements", () => {
  it("excludes a Posting whose text puts it in an Arrangement the User did not accept", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer, Office",
        location: { name: "New York, NY" },
        content: "&lt;p&gt;This is an onsite role, five days a week.&lt;/p&gt;",
      }),
      greenhouseJob({
        id: 2,
        title: "Staff Engineer, Anywhere",
        location: { name: "Remote - US" },
        content: "&lt;p&gt;Fully remote, work from anywhere.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({
        titles: ["Staff Engineer"],
        arrangements: ["remote", "full-time"],
      }),
    );

    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Staff Engineer, Anywhere"]);
  });

  it("passes a Posting whose text names no Arrangement at all", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        location: { name: "New York, NY" },
        content: "&lt;p&gt;Join the platform team building our billing system.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({
        titles: ["Staff Engineer"],
        arrangements: ["remote", "full-time"],
      }),
    );

    expect((await readDashboard(userId)).postings).toHaveLength(1);
  });

  it("excludes on employment type independently of location mode", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer, Salaried",
        location: { name: "Remote - US" },
        content: "&lt;p&gt;Full-time and fully remote.&lt;/p&gt;",
      }),
      greenhouseJob({
        id: 2,
        title: "Staff Engineer, Sessional",
        location: { name: "Remote - US" },
        content: "&lt;p&gt;Part-time, remote, roughly 20 hours a week.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      statedCriteria({
        titles: ["Staff Engineer"],
        arrangements: ["remote", "part-time"],
      }),
    );

    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Staff Engineer, Sessional"]);
  });

  it("carries the detected Arrangements onto the Posting", async () => {
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Staff Engineer",
        location: { name: "Remote - US" },
        content: "&lt;p&gt;A full-time, fully remote position.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    const [posting] = (await readDashboard(userId)).postings;
    expect([...posting.arrangements].sort()).toEqual(["full-time", "remote"]);
  });
});

// Filtering by country is no longer a matching concern: the Corpus holds only
// US-based roles by ingestion policy (ADR 0010, superseding ADR 0009). The
// classification and the drop are covered by `us-only-corpus.test.ts`.

describe("the commute radius", () => {
  const BOSTON: Coordinate = { latitude: 42.3601, longitude: -71.0589 };
  const CAMBRIDGE: Coordinate = { latitude: 42.3736, longitude: -71.1097 };
  const NEW_YORK: Coordinate = { latitude: 40.7128, longitude: -74.006 };

  /** Criteria that accept an onsite or hybrid role, bounded 25 miles of Boston. */
  function commuteCriteria(
    overrides: Partial<CriteriaInput> = {},
  ): CriteriaInput {
    return statedCriteria({
      titles: ["Engineer"],
      arrangements: ["full-time", "onsite", "hybrid"],
      homeLocation: "Boston, MA",
      radiusMiles: 25,
      ...overrides,
    });
  }

  /** A job at `location` whose text names `arrangement`. */
  function jobAt(
    id: number,
    title: string,
    location: string,
    arrangement: string,
  ): Record<string, unknown> {
    return greenhouseJob({
      id,
      title,
      location: { name: location },
      content: `&lt;p&gt;This is a ${arrangement} role.&lt;/p&gt;`,
    });
  }

  it("surfaces an onsite Posting inside the radius", async () => {
    geocoderKnows({ "boston, ma": BOSTON, "cambridge, ma": CAMBRIDGE });
    await corpusHas([jobAt(1, "Platform Engineer", "Cambridge, MA", "onsite")]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());

    const { postings } = await readDashboard(userId);
    expect(postings.map((p) => p.title)).toEqual(["Platform Engineer"]);
    expect(postings[0].unresolvedLocation).toBe(false);
  });

  it("excludes an onsite Posting outside the radius", async () => {
    geocoderKnows({ "boston, ma": BOSTON, "new york, ny": NEW_YORK });
    await corpusHas([jobAt(1, "Platform Engineer", "New York, NY", "onsite")]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());

    expect((await readDashboard(userId)).postings).toHaveLength(0);
  });

  it("excludes a hybrid Posting outside the radius on the same basis", async () => {
    geocoderKnows({ "boston, ma": BOSTON, "new york, ny": NEW_YORK });
    await corpusHas([jobAt(1, "Platform Engineer", "New York, NY", "hybrid")]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());

    expect((await readDashboard(userId)).postings).toHaveLength(0);
  });

  it("leaves a remote Posting alone wherever it is based, for a User who accepts remote", async () => {
    geocoderKnows({ "boston, ma": BOSTON });
    await corpusHas([
      jobAt(1, "Platform Engineer", "San Francisco, CA", "fully remote"),
    ]);
    const userId = await givenAUser();

    await saveCriteria(
      userId,
      commuteCriteria({
        arrangements: ["full-time", "onsite", "hybrid", "remote"],
      }),
    );

    expect((await readDashboard(userId)).postings.map((p) => p.title)).toEqual([
      "Platform Engineer",
    ]);
  });

  // The bug in the report on #73: a User who wants onsite/hybrid
  // work near Franklin, MA was seeing roles in Austin and Costa Mesa, because a
  // Posting whose text never named a location mode bypassed the radius
  // entirely. A User who does not accept remote is asking for work they can get
  // to — every resolved location is measured.
  describe("a User who does not accept remote", () => {
    it("excludes a Posting outside the radius even when its text names no location mode", async () => {
      geocoderKnows({ "boston, ma": BOSTON, "austin, tx": { latitude: 30.2672, longitude: -97.7431 } });
      await corpusHas([
        greenhouseJob({
          id: 1,
          title: "Platform Engineer",
          location: { name: "Austin, TX" },
          content: "&lt;p&gt;Join our team.&lt;/p&gt;", // says nothing about onsite/hybrid/remote
        }),
      ]);
      const userId = await givenAUser();

      await saveCriteria(userId, commuteCriteria());

      expect((await readDashboard(userId)).postings).toHaveLength(0);
    });

    it("keeps a silent-on-arrangement Posting inside the radius", async () => {
      geocoderKnows({ "boston, ma": BOSTON, "cambridge, ma": CAMBRIDGE });
      await corpusHas([
        greenhouseJob({
          id: 1,
          title: "Platform Engineer",
          location: { name: "Cambridge, MA" },
          content: "&lt;p&gt;Join our team.&lt;/p&gt;",
        }),
      ]);
      const userId = await givenAUser();

      await saveCriteria(userId, commuteCriteria());

      expect((await readDashboard(userId)).postings.map((p) => p.title)).toEqual([
        "Platform Engineer",
      ]);
    });

    it("excludes a far Posting that offers remote — the User did not ask for remote", async () => {
      geocoderKnows({ "boston, ma": BOSTON, "new york, ny": NEW_YORK });
      await corpusHas([
        jobAt(1, "Platform Engineer", "New York, NY", "remote or onsite"),
      ]);
      const userId = await givenAUser();

      await saveCriteria(userId, commuteCriteria());

      expect((await readDashboard(userId)).postings).toHaveLength(0);
    });

    it("still surfaces a silent-on-arrangement Posting whose location will not geocode", async () => {
      geocoderKnows({ "boston, ma": BOSTON });
      await corpusHas([
        greenhouseJob({
          id: 1,
          title: "Platform Engineer",
          location: { name: "Undisclosed location, USA" },
          content: "&lt;p&gt;Join our team.&lt;/p&gt;",
        }),
      ]);
      const userId = await givenAUser();

      await saveCriteria(userId, commuteCriteria());

      expect((await readDashboard(userId)).postings.map((p) => p.title)).toEqual([
        "Platform Engineer",
      ]);
    });
  });

  it("surfaces an onsite Posting whose location will not geocode, flagged unresolved", async () => {
    geocoderKnows({ "boston, ma": BOSTON });
    await corpusHas([
      jobAt(1, "Platform Engineer", "Undisclosed location, USA", "onsite"),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());

    const [posting] = (await readDashboard(userId)).postings;
    expect(posting.title).toBe("Platform Engineer");
    expect(posting.unresolvedLocation).toBe(true);
  });

  it("geocodes each distinct location once, however many Postings share it", async () => {
    const geo = geocoderKnows({ "boston, ma": BOSTON });
    await corpusHas([
      jobAt(1, "Platform Engineer", "Boston, MA", "onsite"),
      jobAt(2, "Data Engineer", "Boston,  MA", "onsite"),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());

    // The two Postings and the home location all normalize to one string.
    expect(geo.queries()).toEqual(["boston, ma"]);
  });

  // A Fetch can introduce hundreds of new location strings at once. Geocoding
  // is one Nominatim call a second, and a match run warms the cache before it
  // can match — so an unbounded warm-up made "Run matching now" (which awaits
  // the run) take minutes and be killed at the platform's function ceiling
  // (FUNCTION_INVOCATION_TIMEOUT). One run now geocodes a bounded batch; the
  // rest are picked up by later runs, and a Posting whose location is not yet
  // resolved is surfaced meanwhile, not dropped.
  it("bounds the geocoding one match run does, finishing it over later runs", async () => {
    const cities = Array.from({ length: 20 }, (_, i) => `City${i}, TX`);
    const key = (city: string) => normalizeLocation(city) as string;
    const geo = geocoderKnows(
      Object.fromEntries([
        ["boston, ma", BOSTON],
        ...cities.map((city) => [key(city), BOSTON] as const),
      ]),
    );
    await corpusHas(
      cities.map((city, i) => jobAt(i + 1, "Platform Engineer", city, "onsite")),
    );
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria()); // the first match run

    const geocoded = () =>
      cities.filter((city) => geo.queries().includes(key(city))).length;

    // One run did not geocode all twenty.
    expect(geocoded()).toBeLessThan(cities.length);

    // The Postings whose locations are not resolved yet are still on the
    // Dashboard, flagged unresolved rather than hidden.
    const shown = await readDashboard(userId);
    expect(shown.postings.length).toBe(cities.length);
    expect(shown.postings.some((p) => p.unresolvedLocation)).toBe(true);

    // Later runs drain the rest.
    for (let i = 0; i < 5; i++) await matchCriteria(userId);
    expect(geocoded()).toBe(cities.length);
  });

  it("resolves a known location from cache on the next match run", async () => {
    geocoderKnows({ "boston, ma": BOSTON, "cambridge, ma": CAMBRIDGE });
    await corpusHas([jobAt(1, "Platform Engineer", "Cambridge, MA", "onsite")]);
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const geo = geocoderKnows({ "boston, ma": BOSTON, "cambridge, ma": CAMBRIDGE });
    await saveCriteria(userId, commuteCriteria());

    expect(geo.queries()).toEqual([]);
  });

  it("does no geocoding for a User whose Criteria set no radius", async () => {
    const geo = geocoderKnows({ "boston, ma": BOSTON });
    await corpusHas([jobAt(1, "Platform Engineer", "Boston, MA", "onsite")]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Engineer"] }));

    expect(geo.queries()).toEqual([]);
  });

  it("flags no location as unresolved for a User who does not filter by distance", async () => {
    geocoderKnows({});
    await corpusHas([
      greenhouseJob({
        id: 1,
        title: "Platform Engineer",
        location: { name: "New York, NY" },
        content: "&lt;p&gt;A fully remote role.&lt;/p&gt;",
      }),
    ]);
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ titles: ["Engineer"] }));

    const [posting] = (await readDashboard(userId)).postings;
    expect(posting.unresolvedLocation).toBe(false);
  });

  it("surfaces an onsite Posting when the geocoder is down, then filters it once it recovers", async () => {
    geocoderIsDown();
    await corpusHas([jobAt(1, "Platform Engineer", "New York, NY", "onsite")]);
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria());
    expect(
      (await readDashboard(userId)).postings.map((p) => p.title),
    ).toEqual(["Platform Engineer"]);

    geocoderKnows({ "boston, ma": BOSTON, "new york, ny": NEW_YORK });
    await saveCriteria(userId, commuteCriteria());
    expect((await readDashboard(userId)).postings).toHaveLength(0);
  });
});
