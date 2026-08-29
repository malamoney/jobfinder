import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  addBoard,
  fetchBoard,
  matchCriteria,
  readDashboard,
  saveCriteria,
  type Board,
} from "@/operations";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
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
