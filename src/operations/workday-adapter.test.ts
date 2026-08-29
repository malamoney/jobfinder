import { beforeEach, describe, expect, it, vi } from "vitest";
import { addBoard, fetchBoard, listPostings, type Board } from "@/operations";
import type { WorkdayTenant } from "@/sources/workday-tenants";
import {
  WORKDAY_TEST_TENANT,
  workdayBoardRefuses,
  workdayBoardReturns,
  workdayDetail,
  workdayListing,
} from "@/test/fixtures/workday";

/**
 * The registry under test: the one test tenant, a second for the cross-tenant
 * Source Key case, and one whose config would not make a safe hostname. The
 * factory imports the fixture so the tenant it builds URLs from is the same
 * object the adapter resolves.
 */
vi.mock("@/sources/workday-tenants", async () => {
  const { WORKDAY_TEST_TENANT: base } = await import("@/test/fixtures/workday");
  return {
    WORKDAY_TENANTS: {
      acme: base,
      globex: { ...base, tenant: "globex", company: "Globex" },
      hostile: { ...base, shard: "wd1.evil.example.com" },
    },
  };
});

const GLOBEX: WorkdayTenant = {
  ...WORKDAY_TEST_TENANT,
  tenant: "globex",
  company: "Globex",
};

/**
 * The Workday adapter (#16), fetched for real through `fetchBoard` — a real
 * Fetch against a real database, MSW supplying the tenant's responses — so one
 * assertion covers the adapter, the Source Key upsert, and persistence
 * together, the way every other Source is tested.
 *
 * Workday gets its own file rather than a row in `source-adapters.test.ts`
 * because it is shaped differently on every axis that file's shared cases
 * assume: the list is a POST, a description is a second request, and the
 * tenant is not addressable from the Slug. The registry is mocked to the one
 * test tenant so a real NVIDIA config is not a dependency of the suite.
 */

/** Puts the test Workday tenant into the curated set. */
function givenATenant(slug = "acme"): Promise<Board> {
  return addBoard({ source: "workday", slug });
}

describe("fetching a Workday tenant", () => {
  let acme: Board;

  beforeEach(async () => {
    acme = await givenATenant();
  });

  it("stores a job from its list entry and its detail request", async () => {
    workdayBoardReturns([
      {
        listing: workdayListing({
          externalPath: "/job/US-CA-Santa-Clara/Staff-Engineer_JR1",
        }),
        detail: workdayDetail({
          title: "Staff Engineer, Infrastructure",
          jobDescription: "<p>Build the thing.</p>",
          location: "Santa Clara, CA",
          remoteType: "Hybrid",
          startDate: "2026-06-17",
          externalUrl: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/x_JR1",
        }),
      },
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0]).toMatchObject({
      source: "workday",
      // Tenant-prefixed: a requisition id is only unique within a tenant.
      sourceId: "acme:/job/US-CA-Santa-Clara/Staff-Engineer_JR1",
      boardId: acme.id,
      // The name from the tenant config, the only place it is stated.
      company: "Acme",
      title: "Staff Engineer, Infrastructure",
      description: "<p>Build the thing.</p>",
      location: "Hybrid - Santa Clara, CA",
      applyUrl: "https://acme.wd1.myworkdayjobs.com/en-US/External/job/x_JR1",
      postedAt: new Date("2026-06-17T00:00:00Z"),
    });
  });

  it("names every location a job is open in, with the workplace type", async () => {
    workdayBoardReturns([
      {
        detail: workdayDetail({
          location: "Austin, TX",
          additionalLocations: ["Remote, USA"],
          remoteType: "Remote",
        }),
      },
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].location).toBe(
      "Remote - Austin, TX / Remote, USA",
    );
  });

  it("falls back to the public job page when the detail omits a URL", async () => {
    const externalPath = "/job/US-TX-Austin/Engineer_JR9";
    workdayBoardReturns([
      {
        listing: workdayListing({ externalPath }),
        detail: workdayDetail({ externalUrl: undefined }),
      },
    ]);

    await fetchBoard(acme);

    expect((await listPostings())[0].applyUrl).toBe(
      `https://acme.wd1.myworkdayjobs.com/en-US/External${externalPath}`,
    );
  });

  it("follows the paged list across every page", async () => {
    const jobs = Array.from({ length: 45 }, (_, index) => ({
      listing: workdayListing({
        externalPath: `/job/x/Engineer_JR${index}`,
      }),
    }));
    workdayBoardReturns(jobs);

    await fetchBoard(acme);

    expect(await listPostings()).toHaveLength(45);
  });

  // Offset paging re-lists a job that shifted down while the loop was walking
  // pages. The Corpus upserts one statement on the Source Key, and Postgres
  // refuses to touch a row twice, so an undeduped repeat would fail the Fetch.
  it("stores one Posting for a job that appears on two pages", async () => {
    const shared = workdayListing({ externalPath: "/job/x/Engineer_SHARED" });
    workdayBoardReturns([
      ...Array.from({ length: 19 }, (_, index) => ({
        listing: workdayListing({ externalPath: `/job/x/Engineer_JR${index}` }),
      })),
      { listing: shared },
      // Page two leads with the same job, shifted across the boundary.
      { listing: shared },
      { listing: workdayListing({ externalPath: "/job/x/Engineer_JRLAST" }) },
    ]);

    await fetchBoard(acme);

    expect(await listPostings()).toHaveLength(21);
  });

  // The ceiling that makes Workday's cost observable: a tenant whose search
  // matches more than the budget fails the Fetch rather than fetching a silent
  // prefix, so #17 records it and someone decides what to do.
  it("fails the Fetch when the tenant matches more jobs than the budget", async () => {
    workdayBoardReturns([{ listing: workdayListing() }], { total: 5_000 });

    await expect(fetchBoard(acme)).rejects.toThrow(/budget/);
    expect(await listPostings()).toEqual([]);
  });

  // The lenient-inbound rule: Sources add fields without notice, on the list
  // envelope, the list entries, and the detail alike.
  it("ignores fields the tenant added since the adapter was written", async () => {
    workdayBoardReturns([
      {
        listing: workdayListing({
          scoreBoost: 1.4,
          newFacet: { id: "abc", visible: true },
        }),
        detail: {
          jobPostingInfo: {
            ...(workdayDetail().jobPostingInfo as Record<string, unknown>),
            compensationBand: { min: 180_000, max: 220_000 },
          },
          hiringOrganization: { name: "Acme Corp" },
        },
      },
    ]);

    await fetchBoard(acme);

    const [posting] = await listPostings();
    expect(posting.title).toBe("Staff Engineer, Infrastructure");
    expect(posting).not.toHaveProperty("compensationBand");
  });

  // The other half of the rule: a field the adapter depends on going missing
  // is a broken tenant, not an empty one — #7 leans on this failing rather
  // than falling through to "the tenant returned nothing" (ADR 0004).
  it("fails the Fetch when a detail is missing a field it depends on", async () => {
    workdayBoardReturns([
      { detail: { jobPostingInfo: { title: "Engineer" } } },
    ]);

    await expect(fetchBoard(acme)).rejects.toThrow(/acme/);
    expect(await listPostings()).toEqual([]);
  });

  it("fails the Fetch when the list endpoint refuses", async () => {
    workdayBoardRefuses(503);

    await expect(fetchBoard(acme)).rejects.toThrow(/503/);
    expect(await listPostings()).toEqual([]);
  });

  it("fails the Fetch when the Slug is not a configured tenant", async () => {
    const ghost = await givenATenant("ghost");

    await expect(fetchBoard(ghost)).rejects.toThrow(/not a configured tenant/);
    expect(await listPostings()).toEqual([]);
  });

  // The shard and tenant land in the hostname, so a config that is not a DNS
  // label is refused before a request is built — the exposure `boardSubdomain`
  // guards for Recruitee, with the shard added.
  it("refuses a tenant whose config would not make a safe hostname", async () => {
    const hostile = await givenATenant("hostile");

    await expect(fetchBoard(hostile)).rejects.toThrow(/not safe in a hostname/);
    expect(await listPostings()).toEqual([]);
  });

  it("updates a job it has seen before rather than duplicating it", async () => {
    workdayBoardReturns([{ detail: workdayDetail({ jobDescription: "<p>v1</p>" }) }]);
    await fetchBoard(acme);
    const [first] = await listPostings();

    workdayBoardReturns([{ detail: workdayDetail({ jobDescription: "<p>v2</p>" }) }]);
    await fetchBoard(acme);

    const postings = await listPostings();
    expect(postings).toHaveLength(1);
    expect(postings[0].id).toBe(first.id);
    expect(postings[0].description).toBe("<p>v2</p>");
  });

  // Workday is an absence Source: one Fetch sees the tenant's whole search
  // slice, so a job that drops out of it moves toward Expired (ADR 0004).
  it("counts a job absent once it drops out of the tenant's list", async () => {
    workdayBoardReturns([
      { listing: workdayListing({ externalPath: "/job/x/Engineer_A" }) },
      { listing: workdayListing({ externalPath: "/job/x/Engineer_B" }) },
    ]);
    await fetchBoard(acme);

    workdayBoardReturns([
      { listing: workdayListing({ externalPath: "/job/x/Engineer_A" }) },
    ]);
    await fetchBoard(acme);

    const gone = (await listPostings()).find((posting) =>
      posting.sourceId.endsWith("Engineer_B"),
    );
    expect(gone?.absentFetches).toBe(1);
  });
});

describe("Workday across two tenants", () => {
  // A requisition id repeats across tenants — two companies both number a job
  // `JR1` — and the tenant prefix on the Source Key is what keeps them apart.
  it("does not let two tenants' jobs collide on a shared requisition id", async () => {
    const acme = await addBoard({ source: "workday", slug: "acme" });
    const globex = await addBoard({ source: "workday", slug: "globex" });
    const externalPath = "/job/x/Engineer_JR1";

    workdayBoardReturns([
      {
        listing: workdayListing({ externalPath }),
        detail: workdayDetail({ title: "Acme Engineer" }),
      },
    ]);
    await fetchBoard(acme);

    workdayBoardReturns(
      [
        {
          listing: workdayListing({ externalPath }),
          detail: workdayDetail({ title: "Globex Engineer" }),
        },
      ],
      { tenant: GLOBEX },
    );
    await fetchBoard(globex);

    const postings = await listPostings();
    expect(postings).toHaveLength(2);
    expect(postings.map((posting) => posting.title).sort()).toEqual([
      "Acme Engineer",
      "Globex Engineer",
    ]);
  });
});
