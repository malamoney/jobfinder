import type { Coordinate } from "@/geocoding/nominatim";

/**
 * How far apart two points are, and how that figure is written (#101).
 *
 * A pure module with nothing behind it — no database, no `fetch` — so the
 * commute operation, the matching funnel, and the browser can all use it.
 *
 * This is a straight line over the surface of the Earth, not a route. A drive
 * is always longer, and the tab says so rather than letting a User read this as
 * a journey. The routing provider that answers the journey question arrives
 * behind its own seam later (#102); nothing here is ever scaled up to stand in
 * for it, because a multiplied guess is a fabricated number.
 */

/**
 * Earth's mean radius in miles.
 *
 * The commute radius measures with this in SQL (`@/operations/matching`) and
 * the commute tab measures with it in TypeScript, so it is defined once: two
 * copies could drift, and a Posting the funnel let through would then be told
 * on its own page that it is outside the radius.
 */
export const EARTH_RADIUS_MILES = 3958.7559;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * The great-circle distance between two coordinates, in miles.
 *
 * The haversine form rather than the spherical law of cosines the SQL stage
 * uses: the two agree to well under a yard at any distance a commute involves,
 * and haversine does not lose precision on the short ones — which is every
 * distance this function is actually asked for.
 */
export function greatCircleMiles(from: Coordinate, to: Coordinate): number {
  const fromLat = radians(from.latitude);
  const toLat = radians(to.latitude);
  const deltaLat = toLat - fromLat;
  const deltaLon = radians(to.longitude - from.longitude);

  const chord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(chord)));
}

/**
 * A distance as a person reads it: a tenth of a mile while that tenth still
 * means something, whole miles once it does not.
 *
 * The cut is made on the rounded figure, so 9.97 miles reads "10 mi" rather
 * than "10.0 mi" — a decimal on a ten is a precision this measurement does not
 * have.
 */
export function formatMiles(miles: number): string {
  const tenths = Math.round(miles * 10) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)} mi`;
  return `${Math.round(tenths).toLocaleString("en-US")} mi`;
}
