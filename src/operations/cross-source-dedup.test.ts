import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  addBoard,
  fetchBoard,
  listPostings,
  markViewed,
  readDashboard,
  readPosting,
  saveCriteria,
  setStatus,
  type Board,
} from "@/operations";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import type { CriteriaInput } from "@/criteria/schema";

/**
 * Cross-Source dedup (#13): the same opening published to more than one Board
 * appears once on the Dashboard, every copy is kept in the Corpus, and a
 * User's Review State follows the opening rather than the individual listing.
 *
 * Tested through the operations seam with two Boards standing in for two
 * Sources — real second Sources are not required (#2). What matters is two
 * Postings with distinct Source Keys that share a Dedup Key.
 */

const PASSWORD = "correct-horse-battery-staple";

async function givenAUser(email = "ada@example.com"): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);

  const [row] = await getDb().select().from(user).where(eq(user.email, email));
  return row.id;
}

function statedCriteria(overrides: Partial<CriteriaInput> = {}): CriteriaInput {
  return {
    titles: ["Staff Platform Engineer"],
    keywords: [],
    arrangements: ["full-time", "remote"],
    ...overrides,
  };
}

/** The two Boards every test here fetches from. */
let ats: Board;
let aggregator: Board;

beforeEach(async () => {
  ats = await addBoard({ source: "greenhouse", slug: "acme" });
  aggregator = await addBoard({ source: "greenhouse", slug: "jobwire" });
});

/** The same opening, as each Board would publish it. */
const RICH_DESCRIPTION =
  "&lt;p&gt;You will own our multi-region platform: the CI fleet, the " +
  "deploy pipeline, and the observability stack. We work in Go and " +
  "Terraform and care a great deal about on-call being humane.&lt;/p&gt;";

/** The ATS listing: the whole posting, linked straight to the employer. */
function atsListing(overrides: Record<string, unknown> = {}) {
  return greenhouseJob({
    id: 111,
    title: "Staff Platform Engineer",
    company_name: "Acme",
    location: { name: "Remote - US" },
    content: RICH_DESCRIPTION,
    absolute_url: "https://job-boards.greenhouse.io/acme/jobs/111",
    ...overrides,
  });
}

/** The aggregator listing: a snippet, behind a redirector. */
function aggregatorListing(overrides: Record<string, unknown> = {}) {
  return greenhouseJob({
    id: 222,
    title: "Staff Platform Engineer",
    company_name: "Acme",
    location: { name: "Remote - US" },
    content: "&lt;p&gt;Staff Platform Engineer at Acme. Apply now.&lt;/p&gt;",
    absolute_url: "https://jobwire.example/out?job=acme-spe&ref=feed",
    ...overrides,
  });
}

/** Fetches both Boards with whatever each currently lists. */
async function sweep(): Promise<void> {
  await fetchBoard(ats);
  await fetchBoard(aggregator);
}

async function idBySourceId(sourceId: string): Promise<string> {
  const posting = (await listPostings()).find((p) => p.sourceId === sourceId);
  if (!posting) throw new Error(`No Posting "${sourceId}" in the Corpus`);
  return posting.id;
}

describe("an opening published to two Boards", () => {
  it("appears once on the Dashboard, counted once", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    const dashboard = await readDashboard(userId);
    expect(dashboard.postings).toHaveLength(1);
    expect(dashboard.matchedCount).toBe(1);
    expect(dashboard.unreviewedCount).toBe(1);
  });

  it("keeps every copy in the Corpus — nothing merged or deleted", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    expect((await listPostings()).map((p) => p.sourceId).sort()).toEqual([
      "111",
      "222",
    ]);
  });

  it("presents the copy with the fuller description and directer apply URL", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    const [card] = (await readDashboard(userId)).postings;
    expect(card.applyUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/111");
    expect(card.description).toContain("multi-region platform");
    expect(card.id).toBe(await idBySourceId("111"));
  });

  it("prefers a live copy when the other has Expired", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    // The ATS drops the role; the aggregator keeps listing it. Two successful
    // empty Fetches of the ATS Board mark its copy Expired (#7).
    boardReturns("acme", []);
    await fetchBoard(ats);
    await fetchBoard(ats);

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    const [card] = (await readDashboard(userId)).postings;
    expect(card.expired).toBe(false);
    expect(card.id).toBe(await idBySourceId("222"));
  });

  it("unions the matched keywords across both copies", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [
      aggregatorListing({
        content: "&lt;p&gt;Acme is hiring. Kubernetes experience a plus.&lt;/p&gt;",
      }),
    ]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(
      userId,
      statedCriteria({ keywords: ["terraform", "kubernetes"] }),
    );

    const [card] = (await readDashboard(userId)).postings;
    expect([...card.matchedKeywords].sort()).toEqual(["kubernetes", "terraform"]);
  });
});

describe("Review State on a deduped opening", () => {
  it("marking the shown copy marks the opening, not just that listing", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    const [card] = (await readDashboard(userId)).postings;
    await setStatus(userId, card.id, "applied");

    // The other listing, the one the Dashboard never showed, reads as applied too.
    const otherListingId = await idBySourceId("222");
    expect((await readPosting(userId, otherListingId))?.review.status).toBe(
      "applied",
    );

    // And the Dashboard still shows the opening as applied.
    const applied = await readDashboard(userId, "applied");
    expect(applied.postings.map((p) => p.id)).toEqual([card.id]);
    expect((await readDashboard(userId)).unreviewedCount).toBe(0);
  });

  it("survives the representative flipping to the other copy", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    const [firstCard] = (await readDashboard(userId)).postings;
    expect(firstCard.id).toBe(await idBySourceId("111"));
    await setStatus(userId, firstCard.id, "interested");

    // The ATS listing loses its description; the aggregator's is now the
    // fuller one, so it becomes the copy the Dashboard presents.
    boardReturns("acme", [atsListing({ content: "&lt;p&gt;.&lt;/p&gt;" })]);
    boardReturns("jobwire", [
      aggregatorListing({ content: RICH_DESCRIPTION }),
    ]);
    await sweep();

    const [card] = (await readDashboard(userId)).postings;
    expect(card.id).toBe(await idBySourceId("222"));
    expect(card.status).toBe("interested");
  });

  it("holds the mark when the matched listing changes but a twin still matches", async () => {
    // Identical title, company, and place on both Boards, so one Dedup Key
    // throughout — only the descriptions move.
    boardReturns("acme", [
      atsListing({ content: "&lt;p&gt;We run Kubernetes at scale.&lt;/p&gt;" }),
    ]);
    boardReturns("jobwire", [
      aggregatorListing({ content: "&lt;p&gt;Join a strong platform team.&lt;/p&gt;" }),
    ]);
    await sweep();

    const userId = await givenAUser();
    // Matches only by a keyword in a description, never by title.
    const criteria = statedCriteria({
      titles: ["Chief of Staff"],
      keywords: ["kubernetes"],
    });
    await saveCriteria(userId, criteria);

    const atsId = await idBySourceId("111");
    expect((await readDashboard(userId)).postings.map((p) => p.id)).toEqual([
      atsId,
    ]);
    await setStatus(userId, atsId, "applied");

    // The company moves the Kubernetes line from the ATS copy to the aggregator's.
    boardReturns("acme", [
      atsListing({ content: "&lt;p&gt;Join a strong platform team.&lt;/p&gt;" }),
    ]);
    boardReturns("jobwire", [
      aggregatorListing({ content: "&lt;p&gt;We run Kubernetes at scale.&lt;/p&gt;" }),
    ]);
    await sweep();
    await saveCriteria(userId, criteria);

    const dashboard = await readDashboard(userId);
    expect(dashboard.postings.map((p) => p.id)).toEqual([
      await idBySourceId("222"),
    ]);
    expect(dashboard.postings[0].status).toBe("applied");
    expect(dashboard.unreviewedCount).toBe(0);
  });

  it("keeps both copies in the Corpus after a Status is set", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());
    const [card] = (await readDashboard(userId)).postings;
    await setStatus(userId, card.id, "not_interested");

    expect(await listPostings()).toHaveLength(2);
  });

  it("opening one listing marks the opening viewed", async () => {
    boardReturns("acme", [atsListing()]);
    boardReturns("jobwire", [aggregatorListing()]);
    await sweep();

    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria());

    // Open the copy the Dashboard does not present.
    await markViewed(userId, await idBySourceId("222"));

    const [card] = (await readDashboard(userId)).postings;
    expect(card.id).toBe(await idBySourceId("111"));
    expect(card.viewed).toBe(true);
  });
});
