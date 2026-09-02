/**
 * How precisely a geocoder placed the text it was given (#100).
 *
 * A vocabulary with nothing behind it — no database, no `fetch` — so the
 * geocoder adapter, the Criteria schema, and the browser form can all speak it
 * without dragging one of the others into their bundle.
 *
 * Three buckets rather than the geocoder's own numeric ladder, because three is
 * what a person needs told: the point is where you said it is, it is the middle
 * of your city, or it is vaguer than that. What matters downstream is only how
 * much to trust a distance measured from it.
 */

/**
 * - `exact`: a street address or a building — a point worth measuring a
 *   commute from.
 * - `city`: a town, a neighbourhood, a street with no number. Anything measured
 *   from it is approximate but usable.
 * - `area`: a county, a state, a country. A radius drawn around it means very
 *   little.
 */
export type LocationPrecision = "exact" | "city" | "area";
