import type { Coordinate } from "@/geocoding/nominatim";

/**
 * The way out of Jobfinder to a map a User can actually explore (#101, user
 * story 10).
 *
 * Google Maps, because it needs no account to open a set of directions and it
 * is the map most people already have on their phone. This is only a link — a
 * URL a browser follows — so it is nothing like the routing-provider decision
 * (ADR 0005's neighbour, recorded for #102): no key, no quota, no request from
 * our side at all.
 *
 * Built from coordinates rather than from the location text, for two reasons.
 * A Posting's location is an employer's free text and may name several offices
 * at once; and the coordinate is the point every other figure on the tab was
 * measured from, so the map opens on the same journey the tab describes.
 */

/** The service the link opens, so the link's own words can name it. */
export const MAPPING_SERVICE = "Google Maps";

/** One end of the journey, as Google Maps' URL API wants it written. */
function place(at: Coordinate): string {
  return `${at.latitude},${at.longitude}`;
}

/** A driving journey between two points, ready to open in a new tab. */
export function directionsUrl(from: Coordinate, to: Coordinate): string {
  const params = new URLSearchParams({
    api: "1",
    origin: place(from),
    destination: place(to),
    travelmode: "driving",
  });

  return `https://www.google.com/maps/dir/?${params}`;
}
