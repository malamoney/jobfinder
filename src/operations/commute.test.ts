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
  readDashboard,
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
import type { Arrangement, CriteriaInput } from "@/criteria/schema";

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
function jobAt(
  location: string,
  says = "Join our team.",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...greenhouseJob({ id: 1 }),
    title: "Platform Engineer",
    location: { name: location },
    content: `&lt;p&gt;${says}&lt;/p&gt;`,
    ...overrides,
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
      // `place` is null because the Posting names one place: the stated text
      // already is that place, so the tab has nothing to tell apart (#113).
      destination: { stated: "Seaport, Boston, MA", place: null, at: SEAPORT },
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

  /**
   * User story 19 — "see when something reached me for another reason" — and
   * the incident #112 was opened over, which are the same moment. A User who
   * does not accept remote is shown a role tagged both remote and onsite,
   * because the funnel could not yet measure it: its location was still being
   * geocoded when their Matches were computed (ADR 0013's transient window).
   * They open it to find out why it is there, and the tab is what answers.
   *
   * Now that the tab reads the radius's own scope, this is where an "outside"
   * verdict is read: on a Posting the radius did measure, in the window before
   * the next match run drops it.
   */
  it("says the Posting is outside the radius when it is", async () => {
    const postingId = await corpusHas([
      jobAt("Austin, TX", "This role is remote or onsite."),
    ]);
    geocoderPlaces("austin, tx", AUSTIN);
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

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

  /**
   * The role #112 was opened over: a Posting whose text offers remote
   * *alongside* onsite, read by a User who accepts neither remote nor that
   * distance. The radius measures it — for them it is an onsite role at a
   * fixed address whatever else the text offers (ADR 0013) — so the tab is the
   * one screen that says how far away it is.
   */
  it("covers a Posting offering remote alongside onsite, for a User who does not accept remote", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote or onsite."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).not.toBeNull();
  });

  /**
   * And the same for a Posting whose text offers remote and nothing else. The
   * User cannot take it remotely, so what is left is the address it is based
   * at — which is exactly what the radius already measured them against.
   */
  it("covers a Posting offering only remote, for a User who does not accept remote", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).not.toBeNull();
  });
});

describe("a Posting that is no journey at all", () => {
  /**
   * User story 20, scoped to the User it was written about (#112): someone who
   * accepts remote will do this job from home, so a commute for it is the
   * journey they will never make. The same Posting *is* a commute for a User
   * who does not accept remote — see "a Posting the User would have to travel
   * to" above.
   */
  it("has nothing to show for a remote Posting, for a User who accepts remote", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      commuteCriteria({ arrangements: ["full-time", "onsite", "remote"] }),
    );

    expect(await readCommute(userId, postingId)).toBeNull();
  });

  /**
   * The one case #112 narrowed rather than widened. A Posting whose text says
   * nothing about where the work happens used to get a tab for everyone; the
   * radius has never measured it for a User who accepts remote, giving it the
   * same benefit of the doubt the Arrangement stage gives a silent axis
   * (ADR 0013). The tab now gives it too, so the two cannot disagree about
   * which Postings were measured — the drift this ticket exists to end.
   */
  it("has nothing to show for a Posting silent on where the work happens, for a User who accepts remote", async () => {
    const postingId = await corpusHas([jobAt("Seaport, Boston, MA")]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      commuteCriteria({ arrangements: ["full-time", "onsite", "remote"] }),
    );

    expect(await readCommute(userId, postingId)).toBeNull();
  });

  it("has nothing to show for a dual-tagged Posting, for a User who accepts remote", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote or onsite."),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(
      userId,
      commuteCriteria({ arrangements: ["full-time", "onsite", "remote"] }),
    );

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

  /**
   * An Unresolved location answers null whatever the stance and whatever the
   * text says — including the Postings the stance newly brings into scope
   * (#112). A gap in the data must not become a broken screen (user story 21),
   * and widening which Postings are journeys must not widen that.
   */
  it("has nothing to show for an unplaceable dual-tagged Posting, for a User who does not accept remote", async () => {
    const postingId = await corpusHas([
      jobAt("Undisclosed location, USA", "This role is remote or onsite."),
    ]);
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
      // `place` is null because the Posting names one place: the stated text
      // already is that place, so the tab has nothing to tell apart (#113).
      destination: { stated: "Seaport, Boston, MA", place: null, at: SEAPORT },
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
   * The one Posting where a Criteria-less User's absent stance decides
   * something (#112): the scope rule asks a stance only whether it includes
   * remote, and an unstated one does not, so a Posting offering remote is a
   * journey for them.
   *
   * Pinned deliberately, because it is a change: the tab used to read the
   * Posting's text alone and gave this User nothing here. Showing it is the
   * direction that hides nothing — nobody has said this User would take a
   * remote role, and the radius has no reading of its own to contradict, since
   * with no Criteria there is no radius to run. What they get is user story
   * 22's prompt to state a home location, never an invented distance. User
   * story 20 is scoped to a User who accepts remote, and this is not yet one.
   */
  it("shows the tab on a remote Posting to a User who has stated no Criteria", async () => {
    const postingId = await corpusHas([
      jobAt("Seaport, Boston, MA", "This role is remote."),
    ]);
    // Placed by a User who does commute there: a Criteria-less User's own match
    // run geocodes nothing, because there is no radius to warm the cache for.
    geocoderPlaces("seaport, boston, ma");
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());

    const userId = await givenAUser();

    expect((await readCommute(userId, postingId))?.home).toEqual({
      state: "none",
    });
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
 * Which Postings are a journey at all, and why that is the commute radius's
 * own question (#112).
 *
 * ADR 0013 scopes the radius by the User's stance on remote, and #111 put that
 * rule in one place — `radiusApplies` (`@/commute/radius-scope`) — after it
 * drifted between the funnel stage and the **Location unresolved** flag. This
 * tab was the third statement of it, and it read the Posting's text alone: a
 * role tagged both remote and hybrid was measured by the radius, dropped from
 * the Dashboard for being too far, and then offered no screen that said how
 * far. That is the defect, and these two tests are what stop it recurring.
 *
 * They are deliberately different in kind. The first writes out by hand which
 * Postings each stance gets a tab on, so the behaviour is pinned without
 * reference to any of the code that decides it. The second asks the funnel
 * itself: over a Posting outside the radius, the tab appears exactly where the
 * funnel dropped the Posting. That equivalence is the whole point of the
 * ticket, and it breaks the moment either reader of the rule drifts again.
 */
describe("the tab and the commute radius ask the same question", () => {
  /** Every shape a Posting's text can take on the location axis. */
  const ARRANGEMENT_TEXTS = {
    "says nothing": "Join our team.",
    onsite: "This is an onsite role.",
    hybrid: "A hybrid role, three days in the office.",
    "onsite or hybrid": "An onsite or hybrid role, team by team.",
    remote: "This role is remote.",
    "remote or onsite": "This role is remote or onsite.",
    "remote or hybrid": "This role is remote or hybrid.",
    "remote, onsite or hybrid": "This role is remote, onsite or hybrid.",
  } as const;

  type ArrangementText = keyof typeof ARRANGEMENT_TEXTS;

  const SHAPES = Object.keys(ARRANGEMENT_TEXTS) as ArrangementText[];

  /** Far enough from home that a 30-mile radius drops every one of them. */
  const FAR = "Austin, TX";

  const STANCES: Array<[string, Arrangement[]]> = [
    ["a User who does not accept remote", ["full-time", "onsite", "hybrid"]],
    ["a User who accepts remote", ["full-time", "onsite", "hybrid", "remote"]],
  ];

  /**
   * The tab each stance gets, per shape of text — written out rather than
   * derived, so it says what a User sees instead of restating the rule the
   * code already holds.
   *
   * A User who does not accept remote gets every one of them: every role is a
   * commute for them, so every resolved address is a distance worth reading.
   * A User who accepts remote gets only the roles their own remote option
   * cannot rescue — and, as the radius does, is given the benefit of the doubt
   * on a Posting that says nothing about where the work happens.
   */
  const TAB_SHOWN: Record<string, Record<ArrangementText, boolean>> = {
    "a User who does not accept remote": {
      "says nothing": true,
      onsite: true,
      hybrid: true,
      "onsite or hybrid": true,
      remote: true,
      "remote or onsite": true,
      "remote or hybrid": true,
      "remote, onsite or hybrid": true,
    },
    "a User who accepts remote": {
      "says nothing": false,
      onsite: true,
      hybrid: true,
      "onsite or hybrid": true,
      remote: false,
      "remote or onsite": false,
      "remote or hybrid": false,
      "remote, onsite or hybrid": false,
    },
  };

  /** One Posting per shape of text, all at the same far place. */
  async function corpusOfEveryArrangement(): Promise<
    Record<ArrangementText, string>
  > {
    boardReturns(
      "acme",
      SHAPES.map((shape, index) =>
        jobAt(FAR, ARRANGEMENT_TEXTS[shape], {
          id: index + 1,
          // Distinct titles keep these eight openings eight Dedup Keys, so the
          // Dashboard presents each rather than a Representative of them all.
          title: `Platform Engineer ${index + 1}`,
        }),
      ),
    );
    await fetchBoard(acme);

    const placed = await listPostings();
    const byShape = {} as Record<ArrangementText, string>;
    SHAPES.forEach((shape, index) => {
      const posting = placed.find((p) => p.sourceId === String(index + 1));
      if (!posting) throw new Error(`No Posting saying "${shape}" in the Corpus`);
      byShape[shape] = posting.id;
    });
    return byShape;
  }

  /** A User of the given stance, with a corpus of far Postings behind them. */
  async function givenAStance(arrangements: Arrangement[]) {
    const postings = await corpusOfEveryArrangement();
    geocoderPlaces("austin, tx", AUSTIN);
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria({ arrangements }));
    return { userId, postings };
  }

  /** Which shapes of Posting this User is shown the tab on. */
  async function tabsShown(
    userId: string,
    postings: Record<ArrangementText, string>,
  ): Promise<Record<ArrangementText, boolean>> {
    const shown = {} as Record<ArrangementText, boolean>;
    for (const shape of SHAPES) {
      shown[shape] = (await readCommute(userId, postings[shape])) !== null;
    }
    return shown;
  }

  describe.each(STANCES)("%s", (stance, arrangements) => {
    it("gets the tab on exactly the Postings that are a journey for them", async () => {
      const { userId, postings } = await givenAStance(arrangements);

      expect(await tabsShown(userId, postings)).toEqual(TAB_SHOWN[stance]);
    });

    /**
     * Every Posting here is outside the stated radius, so the funnel drops
     * precisely the ones the radius acted on — and the tab appears on precisely
     * those too. Read the other way: a Posting the User was never shown,
     * because it was too far, is one they can still open and be told why, and a
     * Posting the funnel left alone offers no journey to invent.
     */
    it("is shown the tab on exactly the Postings the funnel dropped", async () => {
      const { userId, postings } = await givenAStance(arrangements);

      const matched = new Set(
        (await readDashboard(userId)).postings.map((posting) => posting.id),
      );

      const dropped = {} as Record<ArrangementText, boolean>;
      for (const shape of SHAPES) {
        dropped[shape] = !matched.has(postings[shape]);
      }

      expect(await tabsShown(userId, postings)).toEqual(dropped);
    });
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
      place: null,
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

/**
 * A Posting offered in more than one place (#113).
 *
 * The radius judges such a Posting on the place closest to the User, so that is
 * the place the tab has to describe — a tab quoting the distance to Seattle for
 * a role the Dashboard kept because of its Boston office would be explaining a
 * decision nobody made. And it says which place that is, because a User reading
 * one distance against a location naming two would otherwise assume it was the
 * only one.
 */
describe("a Posting offered in more than one place", () => {
  const TWO_OFFICES = "Austin, TX / Seaport, Boston, MA";

  /** The home, and both of the Posting's places. */
  function geocoderPlacesBoth() {
    return geocoderKnows({
      [HOME_ADDRESS]: { ...HOME, placeRank: 30 },
      "austin, tx": AUSTIN,
      "seaport, boston, ma": SEAPORT,
    });
  }

  it("measures the closest place, whichever order the text names them in", async () => {
    const postingId = await corpusHas([
      jobAt(TWO_OFFICES, "This is an onsite role."),
    ]);
    geocoderPlacesBoth();
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const commute = await readCommute(userId, postingId);

    expect(commute?.destination.at).toEqual(SEAPORT);
    // Boston is the second place the text names, and the only one that decides
    // anything: Austin is 1,700 miles away and would have read "outside".
    expect(commute?.home).toMatchObject({
      distanceMiles: expect.closeTo(4.6255312, 6),
    });
    expect(commute && radiusVerdict(commute)).toBe("within");
  });

  it("says which of the places it is describing, in the employer's words", async () => {
    const postingId = await corpusHas([
      jobAt(TWO_OFFICES, "This is an onsite role."),
    ]);
    geocoderPlacesBoth();
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const commute = await readCommute(userId, postingId);

    expect(commute?.destination.place).toBe("Seaport, Boston, MA");
    // The employer's whole text is still what the tab shows as the Posting's
    // location: naming the measured place adds to that rather than replacing it.
    expect(commute?.destination.stated).toBe(TWO_OFFICES);
  });

  it("asks the router about the closest place rather than the first one", async () => {
    const postingId = await corpusHas([
      jobAt(TWO_OFFICES, "This is an onsite role."),
    ]);
    geocoderPlacesBoth();
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    routingIsConfigured();
    const router = routerKnows({
      arriving: { minutes: 24 },
      leaving: { minutes: 31 },
    });
    await readCommute(userId, postingId);

    for (const request of router.requests()) {
      expect(request.journey).toContain(
        `${SEAPORT.latitude},${SEAPORT.longitude}`,
      );
    }
  });

  it("describes the one place that could be placed when the others could not", async () => {
    const postingId = await corpusHas([
      jobAt(
        "Undisclosed location, USA / Seaport, Boston, MA",
        "This is an onsite role.",
      ),
    ]);
    geocoderPlaces("seaport, boston, ma");
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    const commute = await readCommute(userId, postingId);

    expect(commute?.destination).toMatchObject({
      place: "Seaport, Boston, MA",
      at: SEAPORT,
    });
  });

  it("shows no tab at all when none of its places could be placed", async () => {
    const postingId = await corpusHas([
      jobAt(
        "Undisclosed location, USA / Somewhere else, USA",
        "This is an onsite role.",
      ),
    ]);
    geocoderKnows({ [HOME_ADDRESS]: { ...HOME, placeRank: 30 } });
    const userId = await givenAUser();
    await saveCriteria(userId, commuteCriteria());

    expect(await readCommute(userId, postingId)).toBeNull();
  });

  /**
   * There is no closest without somewhere to measure from, and the tab is
   * showing the "state a home location" prompt rather than a distance (user
   * story 22). So the first place the Posting names is the one it is named
   * after — a stable answer rather than an arbitrary one.
   */
  it("names the first place when there is no home to measure from", async () => {
    const postingId = await corpusHas([
      jobAt(TWO_OFFICES, "This is an onsite role."),
    ]);
    geocoderPlacesBoth();
    const commuter = await givenAUser("commuter@example.com");
    await saveCriteria(commuter, commuteCriteria());

    const userId = await givenAUser();
    const commute = await readCommute(userId, postingId);

    expect(commute?.home).toEqual({ state: "none" });
    expect(commute?.destination).toMatchObject({
      place: "Austin, TX",
      at: AUSTIN,
    });
  });
});
