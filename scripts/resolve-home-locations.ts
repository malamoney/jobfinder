/**
 * Resolves every stored home location to a coordinate on its own Criteria row.
 *
 *   pnpm resolve-home-locations            # place the homes that have no point yet
 *   pnpm resolve-home-locations --refresh  # re-place every home, including placed ones
 *
 * A User's home location is resolved when they save their Criteria (#100,
 * ADR 0014) and kept with those Criteria — unlike a Posting's location, it never
 * enters the `geocodes` cache that every User shares. Criteria stated before
 * that existed hold a home location and no point.
 *
 * Nothing is broken meanwhile: a match run places such a row as it goes, and
 * until it has, the commute radius falls back to looking the home up in the
 * shared cache the way it used to. This is simply the pass that does the lot in
 * one go rather than a User at a time — worth running once after deploying
 * #100. Paced at one lookup a second, as Nominatim's usage policy asks
 * (ADR 0005), so it is a hand-run pass rather than anything on a request path.
 *
 * `--refresh` re-asks for homes that already hold a point — for after a change
 * to how a geocoder result is graded.
 *
 * Needs DATABASE_URL. Re-run matching afterwards (the nightly sweep does, or the
 * Dashboard's "Run matching now") for the radius to measure from the new points.
 */
import { closeDb } from "@/db";
import { resolveHomeLocations } from "@/operations";

async function main(): Promise<void> {
  const refresh = process.argv.includes("--refresh");
  console.log(
    refresh
      ? "Re-placing every stored home location. One lookup a second — this can take a while."
      : "Placing stored home locations that have no coordinate yet.",
  );

  const done = await resolveHomeLocations({ refresh });

  console.log(`\nLooked up ${done.checked} home location(s).`);
  console.log(`  ${done.placed} placed on a coordinate.`);
  if (done.notFound > 0) {
    console.log(
      `  ${done.notFound} the geocoder knew no place for — those Users' commute radius does not apply until they correct the address.`,
    );
  }
  if (done.failed > 0) {
    console.log(
      `  ${done.failed} could not be looked up at all. Left as they were; run this again.`,
    );
  }
  console.log("Re-run matching for the radius to measure from them.");
}

try {
  await main();
} finally {
  await closeDb();
}
