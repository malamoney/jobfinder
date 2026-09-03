import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import {
  addBoard,
  fetchBoard,
  listPostings,
  readCommute,
  saveCriteria,
  type Board,
} from "@/operations";
import { radiusVerdict } from "@/commute/schema";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import { geocoderIsDown, geocoderKnows } from "@/test/fixtures/nominatim";
import type { CriteriaInput } from "@/criteria/schema";

/**
 * The COMMUTE DETAILS tab's read (#101).
 *
 * Tested through the operations seam, the way the Criteria, review, and
 * matching reads are: a test says what the geocoder knows, saves Criteria, and
 * asserts on what a User would see on the tab. Nothing here reaches for the
 * geocoder or the `geocodes` table directly.
 *
 * Null is the whole "no tab strip at all" answer — a remote Posting, or one
 * whose location no geocoder could place (user stories 20 and 21).
 */

const PASSWORD = "correct-horse-battery-staple";

const HOME = { latitude: 42.3097, longitude: -71.1151 };
const SEAPORT = { latitude: 42.3519, longitude: -71.0448 };
const CAMBRIDGE = { latitude: 42.3736, longitude: -71.1097 };
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

/** The address the User typed, geocoded exactly as typed (#100, ADR 0014). */
const HOME_ADDRESS = "12 Sedgwick St, Boston, MA";

let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
});

async function givenAUser(email = "ada@example.com"): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);

  const [row] = await getDb().select().from(user).where(eq(user.email, email));
  return row.id;
}

/** Fetches the given jobs into the Corpus and returns the first one's id. */
async function corpusHas(
  jobs: Array<Record<string, unknown>>,
): Promise<string> {
  boardReturns("acme", jobs);
  await fetchBoard(acme);
  const id = String(jobs[0].id);
  const posting = (await listPostings()).find((p) => p.sourceId === id);
  if (!posting) throw new Error(`No Posting "${id}" in the Corpus`);
  return posting.id;
}

/** One job at a place, with text that names an Arrangement or says nothing. */
function jobAt(location: string, says = "Join our team."): Record<string, unknown> {
  return {
    ...greenhouseJob({ id: 1 }),
    title: "Platform Engineer",
    location: { name: location },
    content: `&lt;p&gt;${says}&lt;/p&gt;`,
  };
}

function commuteCriteria(
  overrides: Partial<CriteriaInput> = {},
): CriteriaInput {
  return {
    titles: ["Platform Engineer"],
    keywords: [],
    arrangements: ["full-time", "onsite"],
    homeLocation: HOME_ADDRESS,
    radiusMiles: 30,
    ...overrides,
  };
}

/**
 * What the geocoder knows for a journey between the User's front door and a
 * Posting's place: the home exactly as typed, the Posting's location
 * normalized. `placeRank: 30` is Nominatim's grading for a house number, so
 * the home comes back `exact`.
 */
function geocoderPlaces(postingLocation: string, at = SEAPORT) {
  return geocoderKnows({
    [HOME_ADDRESS]: { ...HOME, placeRank: 30 },
    [postingLocation]: at,
  });
}

describe("a Posting the User would have to travel to", () => {
  it("names both ends, the distance between them, and the stated radius", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const commute = await readCommute(userId, postingId);

    expect(commute).toEqual({
      destination: { stated: "Seaport, Boston, MA", at: SEAPORT },
      home: {
        state: "placed",
        stated: HOME_ADDRESS,
        at: { ...HOME, precision: "exact" },
        // Computed independently of the implementation, so this pins the
        // number a User reads rather than checking the code against itself.
        // `closeTo` rather than equality: the last bit or two of a float
        // depends on the order the terms are summed in, which is not a fact
        // about this feature.
        distanceMiles: expect.closeTo(4.6255312, 6),
      },
      radiusMiles: 30,
    });
  });

  it("says the Posting is within the radius when it is", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const commute = await readCommute(userId, postingId);

    expect(commute && radiusVerdict(commute)).toBe("within");
  });

  it("says the Posting is outside the radius when it is", async () => {
    // A User who also accepts remote: the funnel leaves a silent-on-arrangement
    // Posting alone (ADR 0013), so a far one reaches the Posting page and the
    // tab is what tells them why it is there.
    const postingId = await corpusHas([jobAt("Austin, TX")]);
    geocoderPlaces("austin, tx", AUSTIN);
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      commuteCriteria({ arrangements: ["full-time", "onsite", "remote"] }),
    );

    const commute = await readCommute(userId, postingId);

    expect(
      commute?.home.state === "placed" && commute.home.distanceMiles,
    ).toBeCloseTo(1690.04, 1);
    expect(commute && radiusVerdict(commute)).toBe("outside");
  });

  it("covers a hybrid Posting", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "A hybrid role, three days in the office."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).not.toBeNull();
  });

  // ADR 0013: a Posting whose text names no Arrangement but which has an
  // address the commute radius already measures is a commute like any other.
  it("covers a Posting whose text names no Arrangement", async () => {
    const postingId = await corpusHas([jobAt("Seaport, Boston, MA")]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).not.toBeNull();
  });
});

describe("a Posting that is no journey at all", () => {
  it("has nothing to show for a remote Posting", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).toBeNull();
  });

  it("has nothing to show for a location no geocoder could place", async () => {
    const postingId = await corpusHas([
      jobAt("Undisclosed location, USA", "This is an onsite role."),
    ]);
    // The home resolves; the Posting's location resolves to nothing and is
    // cached as unresolved by the match run.
    geocoderKnows({ [HOME_ADDRESS]: { ...HOME, placeRank: 30 } });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).toBeNull();
  });

  it("has nothing to show for a Posting that is not in the Corpus", async () => {
    const userId = await givenAUser();

    expect(
      await readCommute(userId, "11111111-1111-1111-1111-111111111111"),
    ).toBeNull();
  });

  it("has nothing to show for an id that is not a Posting's", async () => {
    const userId = await givenAUser();

    expect(await readCommute(userId, "not-an-id")).toBeNull();
  });
});

describe("a User with no home to measure from", () => {
  /**
   * The Corpus and its geocodes are shared (ADR 0001, ADR 0005), so a Posting
   * placed by one User's match run is placed for everyone — which is what lets
   * a User who stated no home location still open the tab and be told what to
   * do about it.
   */
  async function givenAPostingPlacedBySomeoneElse(): Promise<string> {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());
    return postingId;
  }

  it("still shows the tab, with no home, no distance and no radius", async () => {
    const postingId = await givenAPostingPlacedBySomeoneElse();
    const userId = await givenAUser();
    await saveCriteria(userId, {
      titles: ["Platform Engineer"],
      keywords: [],
      arrangements: ["full-time", "remote"],
    });

    const commute = await readCommute(userId, postingId);

    expect(commute).toEqual({
      destination: { stated: "Seaport, Boston, MA", at: SEAPORT },
      home: { state: "none" },
      radiusMiles: null,
    });
    expect(commute && radiusVerdict(commute)).toBeNull();
  });

  it("shows the tab for a User who has stated no Criteria at all", async () => {
    const postingId = await givenAPostingPlacedBySomeoneElse();
    const userId = await givenAUser();

    const commute = await readCommute(userId, postingId);

    expect(commute?.home).toEqual({ state: "none" });
  });

  /**
   * The pre-#100 shape: a Criteria row with a home location and no coordinate,
   * whose home string the shared Geocode Cache still holds from when homes went
   * through it. The commute radius falls back to that cache
   * (`resolveHomeCoordinate` in `./matching`), so the tab must too — otherwise
   * the funnel bounds this User correctly while the tab tells them their address
   * could not be placed, which would be false.
   *
   * Staged the way it happens for real: a Posting in the same town as the User
   * puts that town in the cache, and the User then saves while the geocoder is
   * unreachable.
   */
  it("falls back to the shared cache for a home with no coordinate", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
      { ...jobAt("Cambridge, MA", "This is an onsite role."), id: 2 },
    ]);
    geocoderKnows({
      [HOME_ADDRESS]: { ...HOME, placeRank: 30 },
      "seaport, boston, ma": SEAPORT,
      "cambridge, ma": CAMBRIDGE,
    });
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());

    const userId = await givenAUser();
    geocoderIsDown();
    await saveCriteria(
      userId,
      commuteCriteria({ homeLocation: "Cambridge, MA" }),
    );

    const commute = await readCommute(userId, postingId);

    expect(commute?.home).toEqual({
      state: "placed",
      stated: "Cambridge, MA",
      // Graded `city`: the cache is keyed by normalized Posting locations and
      // never saw a street address, so claiming `exact` would overstate it.
      at: { ...CAMBRIDGE, precision: "city" },
      distanceMiles: expect.closeTo(3.6367607, 6),
    });
    expect(commute && radiusVerdict(commute)).toBe("within");
  });

  it("keeps the home the User stated when it could not be placed", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());

    // This User saves while the geocoder is unreachable, so their address is
    // stored with no point — the pre-#100 shape too (`home-location.test.ts`).
    const userId = await givenAUser();
    geocoderIsDown();
    await saveCriteria(
      userId,
      commuteCriteria({ homeLocation: "9 Elm St, Boston, MA" }),
    );

    const commute = await readCommute(userId, postingId);

    expect(commute?.home).toEqual({
      state: "unplaced",
      stated: "9 Elm St, Boston, MA",
    });
    expect(commute?.radiusMiles).toBe(30);
    expect(commute && radiusVerdict(commute)).toBeNull();
  });
});
