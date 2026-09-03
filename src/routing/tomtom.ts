import { z } from "zod";
import type { Coordinate } from "@/geocoding/nominatim";

/**
 * The routing provider: how long a drive between two points typically takes,
 * anchored on a moment (#102, ADR 0015).
 *
 * TomTom is the Source. Unlike the geocoder (ADR 0005) this one needs a key —
 * no keyless engine returns traffic-aware durations, and the whole value of the
 * commute tab is the difference between the 8am number and the 5:30pm one. The
 * key is optional: with none set, `routingKey` answers null, nothing is called,
 * and the tab shows no times rather than an estimate (user story 28).
 *
 * Tested through the operations seam (`commute.test.ts`) with MSW standing in
 * for TomTom, the same way Nominatim and the Source adapters are — the adapter
 * is not injected, it calls `fetch` and MSW controls the boundary.
 */

/** The endpoint the adapter calls. Written out so a test can intercept it. */
export const TOMTOM_ROUTING_URL =
  "https://api.tomtom.com/routing/1/calculateRoute";

/**
 * The ceiling on one lookup.
 *
 * Tighter than the geocoder's ten seconds because this one is on a page render
 * rather than a background match run: a User opening a Posting is waiting, and
 * a provider that stalls must cost them a few seconds and a missing pair of
 * figures, not the page (user story 25).
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/** The key, or null when no routing provider is configured at all. */
export function routingKey(): string | null {
  return process.env.TOMTOM_API_KEY || null;
}

/**
 * When the journey happens, as a local wall-clock moment with no zone on it
 * (`@/commute/drive`'s `journeyAt`).
 *
 * TomTom reads an unzoned moment as local to the end of the journey it anchors:
 * `arriveAt` in the destination's zone, `departAt` in the origin's. That is
 * what makes "there for 9am" and "away at 5:30" mean what they say without this
 * code ever having to know which zone either end is in — and it is why the tab
 * quotes the journey's local time and not the server's.
 */
export type Anchor = { arriveAt: string } | { departAt: string };

/** One route, as much of it as the drive windows need. */
export type Route = {
  /** How long the drive takes, on the provider's historic speed profile. */
  seconds: number;
  /**
   * When the drive starts, with the origin's own offset on it — the answer for
   * an `arriveAt` request, and the alarm clock the User would have to set.
   */
  departureTime: string;
};

/**
 * What the adapter depends on from a TomTom response, and nothing more.
 *
 * `routes` is absent or empty when TomTom understood the request and knows no
 * route between the two points.
 */
const tomtomRoutes = z.object({
  routes: z
    .array(
      z.object({
        summary: z.object({
          travelTimeInSeconds: z.number(),
          departureTime: z.string(),
        }),
      }),
    )
    .nullish(),
});

/**
 * The typical drive from `from` to `to` around `anchor`, or null when TomTom
 * knows no route between them.
 *
 * Null is a definite answer — TomTom understood the request and had no route —
 * and it is safe to cache. Anything else throws: an unreachable provider, a
 * refused key, an exhausted quota, a body this adapter does not understand. The
 * caller turns a throw into no times at all and stores nothing, so a provider
 * that is down today is asked again tomorrow rather than remembered as knowing
 * no route (the same split ADR 0005 made for the geocode cache).
 *
 * `traffic=false` is what makes the figure *typical* rather than live. TomTom
 * always applies its historic speed profile for the day and time asked about;
 * the flag only turns off live incidents and closures, which are precisely the
 * things a User must not mistake this number for (user story 5).
 */
export async function route(
  from: Coordinate,
  to: Coordinate,
  anchor: Anchor,
  signal: AbortSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
): Promise<Route | null> {
  const key = routingKey();
  if (!key) throw new Error("No routing provider is configured");

  const journey = `${place(from)}:${place(to)}`;
  const url = new URL(`${TOMTOM_ROUTING_URL}/${journey}/json`);
  url.searchParams.set("key", key);
  url.searchParams.set("travelMode", "car");
  url.searchParams.set("traffic", "false");
  for (const [name, value] of Object.entries(anchor)) {
    url.searchParams.set(name, value);
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `TomTom returned ${response.status} ${response.statusText} for ${journey}`,
    );
  }

  const parsed = tomtomRoutes.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      "TomTom returned a response this adapter does not understand",
    );
  }

  const summary = parsed.data.routes?.[0]?.summary;
  if (!summary) return null;

  return {
    seconds: summary.travelTimeInSeconds,
    departureTime: summary.departureTime,
  };
}

/** One end of the journey, as TomTom's path wants it written. */
function place(at: Coordinate): string {
  return `${at.latitude},${at.longitude}`;
}
