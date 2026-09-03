import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import {
  addBoard,
  fetchBoard,
  listPostings,
  readCommute,
  saveCriteria,
  DRIVE_MAX_AGE_DAYS,
  type Board,
} from "@/operations";
import { radiusVerdict } from "@/commute/schema";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import { geocoderIsDown, geocoderKnows } from "@/test/fixtures/nominatim";
import {
  routerIsDown,
  routerKnows,
  routerRefuses,
} from "@/test/fixtures/tomtom";
import type { CriteriaInput } from "@/criteria/schema";

/**
 * The COMMUTE DETAILS tab's read (#101, #102).
 *
 * Tested through the operations seam, the way the Criteria, review, and
 * matching reads are: a test says what the geocoder and the routing provider
 * know, saves Criteria, and asserts on what a User would see on the tab.
 * Nothing here reaches for either provider, the `geocodes` table, or the
 * drive-time cache directly.
 *
 * Null is the whole "no tab strip at all" answer — a remote Posting, or one
 * whose location no geocoder could place (user stories 20 and 21).
 *
 * The suite runs with no routing provider configured, which is the fresh-clone
 * state (user story 28); the drive-window tests stub a key in for themselves.
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
  // Explicit rather than inherited, so a developer with a real key exported
  // does not get a different suite from CI.
  vi.stubEnv("TOMTOM_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** Puts a routing provider behind the tab. Nothing is asked without one. */
function routingIsConfigured() {
  vi.stubEnv("TOMTOM_API_KEY", "test-routing-key");
}

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
        // No routing provider is configured here, so there is no drive time —
        // and never a straight line scaled up to stand in for one.
        drive: null,
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
      drive: null,
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

/**
 * The drive windows (#102).
 *
 * Every assertion here is about what a User reads on the tab or about how often
 * the provider was asked at all — never about which function did the caching.
 * The provider is stood up with MSW, the way Nominatim and the Source adapters
 * are, so the adapter under test calls `fetch` exactly as it does in production.
 */
describe("how long the journey actually takes", () => {
  /** A Posting the User commutes to, with a router that knows the journey. */
  async function givenACommute(
    drives: Parameters<typeof routerKnows>[0] = {
      arriving: { minutes: 38, departureTime: "2026-09-03T08:22:00-04:00" },
      leaving: { minutes: 47 },
    },
  ) {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    routingIsConfigured();
    return { userId, postingId, router: routerKnows(drives) };
  }

  it("quotes the morning drive, the time to leave, and the drive home", async () => {
    const { userId, postingId } = await givenACommute();

    const commute = await readCommute(userId, postingId);

    expect(commute?.home.state === "placed" && commute.home.drive).toEqual({
      morning: { seconds: 38 * 60, leaveAt: "08:22" },
      evening: { seconds: 47 * 60 },
    });
  });

  /**
   * The morning is solved for arrival and the evening for departure, and both
   * are asked about the same weekday, so the pair describes one day rather than
   * two. Neither moment carries a zone: that absence is what makes the provider
   * read them as local to the journey rather than to a server in UTC.
   */
  it("asks for a 9am arrival and a 5:30pm departure, in the journey's own time", async () => {
    const { userId, postingId, router } = await givenACommute();

    await readCommute(userId, postingId);

    const [morning, evening] = router.requests();
    expect(morning.arriveAt).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00$/);
    expect(morning.departAt).toBeNull();
    expect(evening.departAt).toMatch(/^\d{4}-\d{2}-\d{2}T17:30:00$/);
    expect(evening.arriveAt).toBeNull();
    expect(morning.arriveAt?.slice(0, 10)).toBe(evening.departAt?.slice(0, 10));
  });

  /** The evening is the journey home, not the morning's read backwards. */
  it("drives home in the evening, not back to the office", async () => {
    const { userId, postingId, router } = await givenACommute();

    await readCommute(userId, postingId);

    const [morning, evening] = router.requests();
    const [from, to] = morning.journey.split(":");
    expect(evening.journey).toBe(`${to}:${from}`);
  });
});

describe("a journey the provider has already been asked about", () => {
  async function givenAUserWhoCommutes(): Promise<string> {
    geocoderKnows({
      [HOME_ADDRESS]: { ...HOME, placeRank: 30 },
      "seaport, boston, ma": SEAPORT,
      // A second User's home, geocoded exactly as they typed it (ADR 0014).
      "Cambridge, MA": CAMBRIDGE,
    });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());
    routingIsConfigured();
    return userId;
  }

  const KNOWN = {
    arriving: { minutes: 38, departureTime: "2026-09-03T08:22:00-04:00" },
    leaving: { minutes: 47 },
  };

  it("is not asked about again when the same page is opened again", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    const userId = await givenAUserWhoCommutes();
    const router = routerKnows(KNOWN);

    await readCommute(userId, postingId);
    const second = await readCommute(userId, postingId);

    expect(router.requests()).toHaveLength(2);
    expect(second?.home.state === "placed" && second.home.drive).toEqual({
      morning: { seconds: 38 * 60, leaveAt: "08:22" },
      evening: { seconds: 47 * 60 },
    });
  });

  /**
   * The reason the cache is keyed by the journey rather than by the Posting: a
   * metro's Corpus is thousands of Postings over a handful of locations, and a
   * key per Posting would multiply one journey into a request each.
   */
  it("is not asked about again for another Posting in the same place", async () => {
    await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
      {
        ...jobAt("Seaport, Boston, MA", "This is an onsite role."),
        id: 2,
        title: "Platform Engineer II",
      },
    ]);
    const userId = await givenAUserWhoCommutes();
    const router = routerKnows(KNOWN);

    for (const posting of await listPostings()) {
      await readCommute(userId, posting.id);
    }

    expect(router.requests()).toHaveLength(2);
  });

  it("is a different journey for a User who lives somewhere else", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    const userId = await givenAUserWhoCommutes();
    const router = routerKnows(KNOWN);
    await readCommute(userId, postingId);

    const other = await givenAUser("grace@example.com");
    await saveCriteria(other, commuteCriteria({ homeLocation: "Cambridge, MA" }));
    await readCommute(other, postingId);

    expect(router.requests()).toHaveLength(4);
  });

  it("is asked again once the stored answer is old enough to have drifted", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    const userId = await givenAUserWhoCommutes();
    routerKnows(KNOWN);
    await readCommute(userId, postingId);

    // Only `Date` is faked: the request timeouts and the pool's own timers are
    // nothing to do with whether a stored answer has aged out.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (DRIVE_MAX_AGE_DAYS + 1) * 86_400_000);
    const later = routerKnows({
      arriving: { minutes: 51, departureTime: "2026-10-06T08:09:00-04:00" },
      leaving: { minutes: 62 },
    });

    const refreshed = await readCommute(userId, postingId);

    expect(later.requests()).toHaveLength(2);
    expect(refreshed?.home.state === "placed" && refreshed.home.drive).toEqual({
      morning: { seconds: 51 * 60, leaveAt: "08:09" },
      evening: { seconds: 62 * 60 },
    });
  });
});

/**
 * Every way the times can be missing, and the one rule they all share: the tab
 * keeps everything the walking skeleton gave it and simply has no times. There
 * is no interpolated figure anywhere in the feature (user story 23).
 */
describe("when there are no times to be had", () => {
  async function givenACommuteNobodyCanRoute(): Promise<{
    userId: string;
    postingId: string;
  }> {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());
    return { userId, postingId };
  }

  /** The tab still carries everything #101 put on it. */
  function expectTheTabIsIntact(commute: Awaited<ReturnType<typeof readCommute>>) {
    expect(commute?.destination).toEqual({
      stated: "Seaport, Boston, MA",
      at: SEAPORT,
    });
    expect(commute?.radiusMiles).toBe(30);
    expect(commute?.home).toEqual({
      state: "placed",
      stated: HOME_ADDRESS,
      at: { ...HOME, precision: "exact" },
      distanceMiles: expect.closeTo(4.6255312, 6),
      drive: null,
    });
  }

  /**
   * The fresh-clone state (user story 28). Nothing is called at all — MSW has
   * no handler for the router in this test, so a request would fail it.
   */
  it("shows no times when no routing provider is configured", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();

    expectTheTabIsIntact(await readCommute(userId, postingId));
  });

  it("shows no times when the provider cannot be reached", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerIsDown();

    expectTheTabIsIntact(await readCommute(userId, postingId));
  });

  it("shows no times when the provider refuses for quota", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerRefuses(429);

    expectTheTabIsIntact(await readCommute(userId, postingId));
  });

  it("shows no times when the provider knows no route between the two", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerKnows({ arriving: null, leaving: null });

    expectTheTabIsIntact(await readCommute(userId, postingId));
  });

  /**
   * Both windows or neither: a User told the morning is forty minutes and shown
   * nothing for the evening would read that as "the evening is fine", which is
   * the asymmetry the two windows exist to expose.
   */
  it("shows no times when only one of the two windows could be answered", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerKnows({ arriving: { minutes: 38 }, leaving: null });

    expectTheTabIsIntact(await readCommute(userId, postingId));
  });

  /**
   * The split ADR 0005 made for the geocode cache: a definite "no route" is
   * remembered, an outage is not.
   */
  it("remembers a journey the provider knows no route for", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    const router = routerKnows({ arriving: null, leaving: null });

    await readCommute(userId, postingId);
    await readCommute(userId, postingId);

    expect(router.requests()).toHaveLength(2);
  });

  it("does not remember an unreachable provider as knowing no route", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerIsDown();
    await readCommute(userId, postingId);

    routerKnows({
      arriving: { minutes: 38, departureTime: "2026-09-03T08:22:00-04:00" },
      leaving: { minutes: 47 },
    });
    const commute = await readCommute(userId, postingId);

    expect(commute?.home.state === "placed" && commute.home.drive).toEqual({
      morning: { seconds: 38 * 60, leaveAt: "08:22" },
      evening: { seconds: 47 * 60 },
    });
  });

  /**
   * An old figure the provider gave us still beats no figure at all: it is a
   * measurement, not an estimate, and the alternative is a tab that empties out
   * because the provider happened to be down this minute.
   */
  it("keeps a stale answer when the refresh cannot be made", async () => {
    const { userId, postingId } = await givenACommuteNobodyCanRoute();
    routingIsConfigured();
    routerKnows({
      arriving: { minutes: 38, departureTime: "2026-09-03T08:22:00-04:00" },
      leaving: { minutes: 47 },
    });
    await readCommute(userId, postingId);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (DRIVE_MAX_AGE_DAYS + 1) * 86_400_000);
    routerIsDown();

    const commute = await readCommute(userId, postingId);

    expect(commute?.home.state === "placed" && commute.home.drive).toEqual({
      morning: { seconds: 38 * 60, leaveAt: "08:22" },
      evening: { seconds: 47 * 60 },
    });
  });

  /** No home is no journey: there is nowhere to measure a drive from. */
  it("asks nobody about a Posting the User has no home to travel from", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This is an onsite role."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());

    const userId = await givenAUser();
    routingIsConfigured();

    expect((await readCommute(userId, postingId))?.home).toEqual({
      state: "none",
    });
  });
});
