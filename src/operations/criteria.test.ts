import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import {
  readCriteria,
  readCriteriaSavedAt,
  readHomeCoordinate,
  saveCriteria,
} from "@/operations";
import { getDb } from "@/db";
import { criteria, geocodes, user } from "@/db/schema";
import { normalizeLocation } from "@/postings/location";
import {
  geocoderIsDown,
  geocoderKnows,
  type Coordinate,
  type Place,
} from "@/test/fixtures/nominatim";
import type { CriteriaInput } from "@/criteria/schema";

const PASSWORD = "correct-horse-battery-staple";

const BOSTON: Coordinate = { latitude: 42.3601, longitude: -71.0589 };
const CAMBRIDGE: Coordinate = { latitude: 42.3736, longitude: -71.1097 };

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
      // Nothing to place: these Criteria accept remote work and state no home.
      home: { state: "none" },
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
      message: expect.stringMatching(/home address|commute radius/i),
    });
  });

  it("stores both when a distance role is accepted", async () => {
    geocoderKnows({ "Boston, MA": BOSTON });
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
    geocoderKnows({ "Boston, MA": BOSTON });
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

/**
 * The home location is asked for as a street address and resolved to a point on
 * the User's own Criteria row (#100), so the commute radius measures from where
 * they live rather than from the middle of their city.
 */
describe("placing the home location", () => {
  /** A street address and the front door the geocoder puts it at. */
  const BEACON_ST = "12 Beacon St, Boston, MA";
  const AT_THE_DOOR: Place = { ...BOSTON, placeRank: 30 };

  /** Criteria that accept an onsite role, so a home location is asked for. */
  function commuteCriteria(homeLocation: string): CriteriaInput {
    return statedCriteria({
      arrangements: ["full-time", "onsite"],
      homeLocation,
      radiusMiles: 30,
    });
  }

  it("resolves the stated address to a coordinate and says how precisely", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, commuteCriteria(BEACON_ST));

    expect(outcome.ok && outcome.home).toEqual({
      state: "placed",
      home: { ...BOSTON, precision: "exact" },
    });
    expect(await readHomeCoordinate(userId)).toEqual({
      ...BOSTON,
      precision: "exact",
    });
  });

  it("reports a city-only answer as a city, so the User knows it is approximate", async () => {
    geocoderKnows({ "Boston, MA": { ...BOSTON, placeRank: 16 } });
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, commuteCriteria("Boston, MA"));

    expect(outcome.ok && outcome.home).toMatchObject({
      state: "placed",
      home: { precision: "city" },
    });
  });

  it("reports an answer broader than a city as an area", async () => {
    geocoderKnows({ Massachusetts: { ...BOSTON, placeRank: 8 } });
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, commuteCriteria("Massachusetts"));

    expect(outcome.ok && outcome.home).toMatchObject({
      state: "placed",
      home: { precision: "area" },
    });
  });

  it("saves anyway when the address cannot be found, and skips the radius", async () => {
    geocoderKnows({});
    const userId = await givenAUser();

    const outcome = await saveCriteria(
      userId,
      commuteCriteria("77 Nowhere Ln, Atlantis"),
    );

    expect(outcome.ok && outcome.home).toEqual({ state: "not-found" });
    expect((await readCriteria(userId))?.homeLocation).toBe(
      "77 Nowhere Ln, Atlantis",
    );
    expect(await readHomeCoordinate(userId)).toBeNull();
  });

  it("saves anyway when the geocoder cannot be reached at all", async () => {
    geocoderIsDown();
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, commuteCriteria(BEACON_ST));

    expect(outcome.ok && outcome.home).toEqual({ state: "unchecked" });
    expect(await readHomeCoordinate(userId)).toBeNull();
  });

  // The normalizer built for a Posting's location strips a parenthetical and a
  // trailing "remote" — right for `Austin, TX (Remote)`, and ruinous for an
  // address. A home location never goes through it.
  it("geocodes an address the Posting-location normalizer would mangle, intact", async () => {
    const address = "12 Beacon St (Apt 4), Boston, MA";
    expect(normalizeLocation(address)).not.toBe(address.toLowerCase());

    const geo = geocoderKnows({ [address]: AT_THE_DOOR });
    const userId = await givenAUser();

    const outcome = await saveCriteria(userId, commuteCriteria(address));

    expect(geo.queries()).toEqual([address]);
    expect(outcome.ok && outcome.home).toMatchObject({ state: "placed" });
  });

  it("never writes the address into the Geocode Cache every User shares", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();

    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    expect(await getDb().select().from(geocodes)).toEqual([]);
  });

  it("clears the coordinate when the home location is cleared", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    await saveCriteria(userId, statedCriteria({ arrangements: ["remote"] }));

    expect(await readHomeCoordinate(userId)).toBeNull();
  });

  it("clears the coordinate when the address is changed for one that cannot be found", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    geocoderKnows({});
    await saveCriteria(userId, commuteCriteria("77 Nowhere Ln, Atlantis"));

    expect(await readHomeCoordinate(userId)).toBeNull();
  });

  it("does not ask the geocoder again for an address already placed", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    const geo = geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const outcome = await saveCriteria(userId, {
      ...commuteCriteria(BEACON_ST),
      keywords: ["rust"],
    });

    expect(geo.queries()).toEqual([]);
    expect(outcome.ok && outcome.home).toMatchObject({ state: "placed" });
  });

  it("asks again when the address changes", async () => {
    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    const geo = geocoderKnows({ "Cambridge, MA": CAMBRIDGE });
    await saveCriteria(userId, commuteCriteria("Cambridge, MA"));

    expect(geo.queries()).toEqual(["Cambridge, MA"]);
    expect(await readHomeCoordinate(userId)).toMatchObject(CAMBRIDGE);
  });

  it("asks again when a save follows one the geocoder could not answer", async () => {
    geocoderIsDown();
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria(BEACON_ST));

    geocoderKnows({ [BEACON_ST]: AT_THE_DOOR });
    const outcome = await saveCriteria(userId, commuteCriteria(BEACON_ST));

    expect(outcome.ok && outcome.home).toMatchObject({ state: "placed" });
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

/**
 * The Criteria page shows a "LAST SAVED Nd ago" kicker (#83), so it needs the
 * save time without the whole row being reshaped — `readCriteria` still hands
 * back only the stated values.
 */
describe("when Criteria were last saved", () => {
  it("has no last-saved time before a User states any", async () => {
    const userId = await givenAUser();

    expect(await readCriteriaSavedAt(userId)).toBeNull();
  });

  it("reports the time of the most recent save", async () => {
    const userId = await givenAUser();
    const before = Date.now();

    await saveCriteria(userId, statedCriteria());

    const savedAt = await readCriteriaSavedAt(userId);
    expect(savedAt).toBeInstanceOf(Date);
    expect(savedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(savedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("moves forward when the statement is revised", async () => {
    const userId = await givenAUser();

    await saveCriteria(userId, statedCriteria());
    const first = await readCriteriaSavedAt(userId);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await saveCriteria(userId, statedCriteria({ titles: ["Staff Engineer"] }));
    const second = await readCriteriaSavedAt(userId);

    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });
});

// "United States only" was removed as a Criterion: the Corpus holds only
// US-based roles by ingestion policy now (ADR 0010, superseding ADR 0009), so
// there is nothing for a per-User toggle to do. `us-only-corpus.test.ts` covers
// the ingestion gate and `prune.test.ts` the removal of roles stored before it.
