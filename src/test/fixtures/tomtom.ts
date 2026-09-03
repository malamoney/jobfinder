import { http, HttpResponse } from "msw";
import { TOMTOM_ROUTING_URL } from "@/routing/tomtom";
import { server } from "@/test/msw";

/**
 * TomTom standing in for the real routing provider (#102).
 *
 * The provider is tested through the operations seam (`commute.test.ts`), the
 * same way Nominatim is: a test declares what the router knows, and the
 * assertions are about the times a User reads on the commute tab and about how
 * often the provider was asked at all.
 *
 * The endpoint is imported from the adapter so a request sent anywhere else
 * fails every test — MSW refuses a request no handler declared.
 */

/** One request the adapter made, in the terms the tab cares about. */
export type RouteRequest = {
  /** `latitude,longitude:latitude,longitude`, as TomTom's path writes it. */
  journey: string;
  /** The moment asked about, and which end of the journey it anchors. */
  arriveAt: string | null;
  departAt: string | null;
};

/** A handle onto what the routing provider was actually asked. */
export type RouterCalls = {
  requests(): RouteRequest[];
};

/**
 * A drive the router knows about.
 *
 * `departureTime` is stated rather than derived so a test asserting on the time
 * a User has to leave reads a literal out of a literal. Left off, it is a
 * plausible moment in Eastern time — enough for a test that does not care.
 */
export type Drive = {
  minutes: number;
  departureTime?: string;
};

const ANY_DEPARTURE = "2026-09-03T08:22:00-04:00";

/**
 * Declares what the router answers for each of the two windows, keyed by which
 * end the request anchors: `arriving` for the morning's `arriveAt`, `leaving`
 * for the evening's `departAt`. A window given `null` is one it knows no route
 * for, which is how TomTom answers a journey it cannot make.
 */
export function routerKnows(drives: {
  arriving?: Drive | null;
  leaving?: Drive | null;
}): RouterCalls {
  return handle(({ arriveAt }) => {
    const drive = arriveAt ? drives.arriving : drives.leaving;
    if (!drive) return HttpResponse.json({ routes: [] });

    return HttpResponse.json({
      routes: [
        {
          summary: {
            travelTimeInSeconds: drive.minutes * 60,
            departureTime: drive.departureTime ?? ANY_DEPARTURE,
            arrivalTime: ANY_DEPARTURE,
          },
        },
      ],
    });
  });
}

/** Declares the router cannot be reached at all — every request throws. */
export function routerIsDown(): RouterCalls {
  return handle(() => HttpResponse.error());
}

/**
 * Declares the router refuses: an exhausted free-tier quota (429), a key it
 * will not accept (403). Distinct from an outage in the wire but not in what a
 * User sees, which is the point of asserting on it.
 */
export function routerRefuses(status = 429): RouterCalls {
  return handle(() => new HttpResponse(null, { status }));
}

function handle(
  answer: (request: RouteRequest) => Response,
): RouterCalls {
  const requests: RouteRequest[] = [];

  server.use(
    http.get(`${TOMTOM_ROUTING_URL}/*`, ({ request }) => {
      const url = new URL(request.url);
      const seen: RouteRequest = {
        journey: url.pathname.split("/").at(-2) ?? "",
        arriveAt: url.searchParams.get("arriveAt"),
        departAt: url.searchParams.get("departAt"),
      };
      requests.push(seen);
      return answer(seen);
    }),
  );

  return { requests: () => [...requests] };
}
