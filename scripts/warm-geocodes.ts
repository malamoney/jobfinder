/**
 * Resolves every location the Corpus holds to a coordinate, in one pass.
 *
 *   pnpm warm-geocodes            # geocode what is not cached yet
 *   pnpm warm-geocodes --refresh  # clear the cache first, then geocode all of it
 *
 * The geocode cache (`geocodes`) is normally filled by match runs, a bounded
 * batch at a time so a single run cannot stall behind the geocoder's one-a-
 * second rate limit (see `ensureGeocoded`, ADR 0005). Right after a large Fetch
 * that is far too slow: the commute-radius stage keeps a Posting whose location
 * it cannot place, so until the cache catches up a User sees onsite roles from
 * anywhere, flagged unresolved.
 *
 * This is the catch-up, run by hand: no serverless ceiling, so it can spend the
 * minutes a few hundred lookups take. `--refresh` also drops what is already
 * cached — use it once after a geocoder fix so stale coordinates are re-resolved
 * (a bare "Franklin, MA" that used to land on Franklin County, say).
 *
 * It re-reads the location text the Corpus already holds before it geocodes
 * anything, so a change to how a location is read reaches the rows already
 * stored (#113): a Posting held as one unplaceable `... / ...` key becomes the
 * two places it always named, and those are what get geocoded here. No re-Fetch
 * is needed for it.
 *
 * Postings only. A User's home location is resolved onto their own Criteria row
 * and never enters this cache (#100) — `pnpm resolve-home-locations` is the
 * equivalent pass for those.
 *
 * Needs DATABASE_URL. Re-run matching afterwards (the nightly sweep does, or the
 * Dashboard button) for the radius to apply to the newly-placed Postings.
 */
import { isNotNull, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { geocodes, postings } from "@/db/schema";
import { renormalizeLocations } from "@/operations/extraction";
import { ensureGeocoded } from "@/operations/geocoding";
import { normalizeLocations } from "@/postings/location";

const NO_BUDGET = Number.MAX_SAFE_INTEGER;

async function main(): Promise<void> {
  const db = getDb();

  if (process.argv.includes("--refresh")) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(geocodes);
    await db.delete(geocodes);
    console.log(`--refresh: cleared ${count} cached location(s).`);
  }

  // Before anything is geocoded: re-read every stored location, so the places
  // this pass resolves are the places the radius will measure (#113).
  const reread = await renormalizeLocations(db);
  console.log(`Re-read ${reread} Posting location(s) into their places.`);

  const postingLocations = await db
    .selectDistinct({ location: postings.location })
    .from(postings)
    .where(isNotNull(postings.location));

  const keys = new Set<string>();
  for (const { location } of postingLocations) {
    for (const key of normalizeLocations(location)) keys.add(key);
  }

  console.log(
    `${keys.size} distinct location(s). Geocoding one a second — this can take a while.`,
  );

  await ensureGeocoded(db, [...keys], NO_BUDGET, (done, total) => {
    if (done % 25 === 0 || done === total) console.log(`  ${done}/${total}`);
  });

  const [{ resolved, unresolvable }] = await db
    .select({
      resolved: sql<number>`count(*) filter (where ${geocodes.latitude} is not null)::int`,
      unresolvable: sql<number>`count(*) filter (where ${geocodes.latitude} is null)::int`,
    })
    .from(geocodes);

  console.log(
    `\nCache holds ${resolved} resolved and ${unresolvable} unresolvable location(s).`,
  );
  console.log("Re-run matching for the commute radius to apply to them.");
}

try {
  await main();
} finally {
  await closeDb();
}
