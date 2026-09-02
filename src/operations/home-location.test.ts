import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { criteria, user } from "@/db/schema";
import {
  readHomeCoordinate,
  resolveHomeLocations,
  saveCriteria,
} from "@/operations";
import {
  geocoderIsDown,
  geocoderKnows,
  type Coordinate,
} from "@/test/fixtures/nominatim";

/**
 * Bringing Criteria stated before #100 up to date.
 *
 * Those rows hold a home location and no coordinate. A match run places one as
 * it goes, and until it has, the commute radius falls back to the shared Geocode
 * Cache as it did before (`matching.test.ts`) — so nothing breaks either way.
 * `pnpm resolve-home-locations` is the pass that does the lot at once, without
 * their Users having to re-save.
 */

const PASSWORD = "correct-horse-battery-staple";
const BOSTON: Coordinate = { latitude: 42.3601, longitude: -71.0589 };
const CAMBRIDGE: Coordinate = { latitude: 42.3736, longitude: -71.1097 };

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
 * A User whose stored Criteria name a home location that was never placed —
 * what a row saved before #100 looks like, staged here by saving while the
 * geocoder is unreachable.
 */
async function givenAnUnplacedHome(
  email: string,
  homeLocation: string,
): Promise<string> {
  const userId = await givenAUser(email);
  geocoderIsDown();
  await saveCriteria(userId, {
    titles: ["Staff Engineer"],
    keywords: [],
    arrangements: ["full-time", "onsite"],
    homeLocation,
    radiusMiles: 30,
  });
  expect(await readHomeCoordinate(userId)).toBeNull();
  return userId;
}

describe("placing home locations that were stored without a coordinate", () => {
  it("places them without the User re-saving their Criteria", async () => {
    const userId = await givenAnUnplacedHome("ada@example.com", "Boston, MA");

    geocoderKnows({ "Boston, MA": BOSTON });
    const done = await resolveHomeLocations();

    expect(done).toEqual({ checked: 1, placed: 1, notFound: 0, failed: 0 });
    expect(await readHomeCoordinate(userId)).toEqual({
      ...BOSTON,
      precision: "city",
    });
  });

  it("leaves alone a home that is already placed", async () => {
    geocoderKnows({ "Boston, MA": BOSTON });
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Staff Engineer"],
      keywords: [],
      arrangements: ["full-time", "onsite"],
      homeLocation: "Boston, MA",
      radiusMiles: 30,
    });

    const geo = geocoderKnows({ "Boston, MA": CAMBRIDGE });
    const done = await resolveHomeLocations();

    expect(done.checked).toBe(0);
    expect(geo.queries()).toEqual([]);
    expect(await readHomeCoordinate(userId)).toMatchObject(BOSTON);
  });

  it("re-places even a placed home when asked to refresh", async () => {
    geocoderKnows({ "Boston, MA": BOSTON });
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Staff Engineer"],
      keywords: [],
      arrangements: ["full-time", "onsite"],
      homeLocation: "Boston, MA",
      radiusMiles: 30,
    });

    geocoderKnows({ "Boston, MA": { ...CAMBRIDGE, placeRank: 30 } });
    const done = await resolveHomeLocations({ refresh: true });

    expect(done).toEqual({ checked: 1, placed: 1, notFound: 0, failed: 0 });
    expect(await readHomeCoordinate(userId)).toEqual({
      ...CAMBRIDGE,
      precision: "exact",
    });
  });

  it("skips a User who stated no home location at all", async () => {
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Staff Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });

    const done = await resolveHomeLocations();

    expect(done.checked).toBe(0);
    expect(await readHomeCoordinate(userId)).toBeNull();
  });

  it("records a home the geocoder knows no place for, and moves on", async () => {
    await givenAnUnplacedHome("ada@example.com", "Atlantis");
    const grace = await givenAnUnplacedHome("grace@example.com", "Boston, MA");

    geocoderKnows({ "Boston, MA": BOSTON });
    const done = await resolveHomeLocations();

    expect(done).toEqual({ checked: 2, placed: 1, notFound: 1, failed: 0 });
    expect(await readHomeCoordinate(grace)).toMatchObject(BOSTON);
  });

  it("leaves a home unplaced, to be retried, when the geocoder is unreachable", async () => {
    const userId = await givenAnUnplacedHome("ada@example.com", "Boston, MA");

    geocoderIsDown();
    expect(await resolveHomeLocations()).toEqual({
      checked: 1,
      placed: 0,
      notFound: 0,
      failed: 1,
    });

    geocoderKnows({ "Boston, MA": BOSTON });
    await resolveHomeLocations();
    expect(await readHomeCoordinate(userId)).toMatchObject(BOSTON);
  });

  it("does not disturb when the User last saved their Criteria", async () => {
    const userId = await givenAnUnplacedHome("ada@example.com", "Boston, MA");
    const [before] = await getDb()
      .select({ updatedAt: criteria.updatedAt })
      .from(criteria)
      .where(eq(criteria.userId, userId));

    geocoderKnows({ "Boston, MA": BOSTON });
    await resolveHomeLocations();

    const [after] = await getDb()
      .select({ updatedAt: criteria.updatedAt })
      .from(criteria)
      .where(eq(criteria.userId, userId));
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
