import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { readCriteria, saveCriteria } from "@/operations";
import { getDb } from "@/db";
import { criteria, user } from "@/db/schema";
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
    titles: ["Staff Engineer", "Principal Engineer"],
    keywords: ["typescript", "postgres"],
    arrangements: ["full-time", "remote"],
    ...overrides,
  };
}

describe("stating Criteria", () => {
  it("has nothing to read back before a User has stated any", async () => {
    const userId = await givenAUser();

    expect(await readCriteria(userId)).toBeNull();
  });

  it("stores titles, keywords, and arrangements and reads them back", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, statedCriteria());

    expect(outcome).toEqual({
      ok: true,
      criteria: {
        titles: ["Staff Engineer", "Principal Engineer"],
        keywords: ["typescript", "postgres"],
        arrangements: ["full-time", "remote"],
        homeLocation: null,
        radiusMiles: null,
        minSalary: null,
      },
    });
    expect(await readCriteria(userId)).toEqual(
      outcome.ok && outcome.criteria,
    );
  });

  it("adding and removing a title is just storing the new list", async () => {
    const userId = await givenAUser();
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));

    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Staff Engineer", "Engineering Manager"] }),
    );
    await saveCriteria(
      userId,
      statedCriteria({ titles: ["Engineering Manager"] }),
    );

    expect((await readCriteria(userId))?.titles).toEqual(["Engineering Manager"]);
  });

  it("keeps exactly one row per User however often they revise", async () => {
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria({ keywords: ["go"] }));
    await saveCriteria(userId, statedCriteria({ keywords: ["rust"] }));
    await saveCriteria(userId, statedCriteria({ keywords: ["elixir"] }));

    const rows = await getDb()
      .select()
      .from(criteria)
      .where(eq(criteria.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].keywords).toEqual(["elixir"]);
  });

  it("keeps one User's Criteria out of another User's", async () => {
    const ada = await givenAUser("ada@example.com");
    const grace = await givenAUser("grace@example.com");

    await saveCriteria(ada, statedCriteria({ titles: ["Staff Engineer"] }));
    await saveCriteria(grace, statedCriteria({ titles: ["Data Scientist"] }));

    expect((await readCriteria(ada))?.titles).toEqual(["Staff Engineer"]);
    expect((await readCriteria(grace))?.titles).toEqual(["Data Scientist"]);
  });

  it("trims each title and keyword and drops exact duplicates", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({
        titles: ["  Staff Engineer  ", "Staff Engineer"],
        keywords: ["postgres", "postgres", " redis "],
      }),
    );

    expect(outcome.ok && outcome.criteria.titles).toEqual(["Staff Engineer"]);
    expect(outcome.ok && outcome.criteria.keywords).toEqual([
      "postgres",
      "redis",
    ]);
  });
});

describe("Criteria that cannot be right", () => {
  it("rejects an empty title list with a specific message", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, statedCriteria({ titles: [] }));

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/at least one job title/i),
    });
    expect(await readCriteria(userId)).toBeNull();
  });

  it("rejects a negative minimum salary with a specific message", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({ minSalary: -1 }),
    );

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/salary cannot be negative/i),
    });
  });

  it("rejects a non-positive radius with a specific message", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({
        arrangements: ["full-time", "onsite"],
        homeLocation: "Boston, MA",
        radiusMiles: 0,
      }),
    );

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/more than zero miles/i),
    });
  });

  it("rejects an unknown key rather than dropping it", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, {
      ...statedCriteria(),
      isAdmin: true,
    });

    expect(outcome.ok).toBe(false);
    expect(await readCriteria(userId)).toBeNull();
  });

  it("turns away an arrangement list longer than the five that exist", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, {
      ...statedCriteria(),
      arrangements: Array.from({ length: 5000 }, () => "remote"),
    });

    expect(outcome.ok).toBe(false);
    expect(await readCriteria(userId)).toBeNull();
  });

  it("needs an empty arrangement selection to be filled in", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({ arrangements: [] }),
    );

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/at least one kind of arrangement/i),
    });
  });
});

describe("home location and radius", () => {
  it("requires both once an onsite or hybrid role is accepted", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({ arrangements: ["hybrid"] }),
    );

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/home location|commute radius/i),
    });
  });

  it("stores both when a distance role is accepted", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({
        arrangements: ["hybrid", "remote"],
        homeLocation: "Boston, MA",
        radiusMiles: 30,
      }),
    );

    expect(outcome.ok && outcome.criteria).toMatchObject({
      homeLocation: "Boston, MA",
      radiusMiles: 30,
    });
  });

  it("clears a stored location and radius once no distance role remains", async () => {
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      statedCriteria({
        arrangements: ["onsite"],
        homeLocation: "Boston, MA",
        radiusMiles: 30,
      }),
    );

    await saveCriteria(
      userId,
      statedCriteria({ arrangements: ["remote"] }),
    );

    expect(await readCriteria(userId)).toMatchObject({
      homeLocation: null,
      radiusMiles: null,
    });
  });
});

describe("minimum salary", () => {
  it("is allowed to be left blank", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({ minSalary: null }),
    );

    expect(outcome.ok && outcome.criteria.minSalary).toBeNull();
  });

  it("is kept when a floor is set", async () => {
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      statedCriteria({ minSalary: 180000 }),
    );

    expect(outcome.ok && outcome.criteria.minSalary).toBe(180000);
  });
});
