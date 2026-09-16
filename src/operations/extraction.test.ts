import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { postings } from "@/db/schema";
import { addBoard, type Board } from "@/operations";
import { renormalizeLocations } from "./extraction";

/**
 * The catch-up pass that re-reads the locations the Corpus already holds
 * (#113).
 *
 * Extraction itself is tested through the matching seam, but this is the one
 * part of it no match run reaches: it exists for the rows a re-Fetch will not
 * revisit, and `pnpm warm-geocodes` runs it before it fills the geocode cache.
 * So it is exercised directly here, the way `ensureGeocoded`'s budget is
 * (`geocoding.test.ts`).
 *
 * Rows are inserted straight into the Corpus with the keys the old reading gave
 * them — one unsplit string for a location naming two places — which is exactly
 * the state a Corpus is in the moment this ships.
 */

let board: Board;

beforeEach(async () => {
  board = await addBoard({ source: "greenhouse", slug: "acme" });
});

/** A stored role, with the places a previous reading of its location gave it. */
async function storedRole(
  sourceId: string,
  location: string | null,
  places: string[],
): Promise<string> {
  const [row] = await getDb()
    .insert(postings)
    .values({
      source: "greenhouse",
      sourceId,
      boardId: board.id,
      company: "Acme",
      title: "Staff Data Engineer",
      description: "<p>Build the thing.</p>",
      dedupKey: `acme|staff data engineer|${sourceId}`,
      location,
      normalizedLocations: places,
      country: "us",
      extractedAt: new Date(),
      applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${sourceId}`,
    })
    .returning({ id: postings.id });
  return row.id;
}

/** The places a stored Posting is measured on. */
async function placesOf(id: string): Promise<string[]> {
  const [row] = await getDb()
    .select({ places: postings.normalizedLocations })
    .from(postings)
    .where(eq(postings.id, id));
  return row.places;
}

describe("re-reading the locations the Corpus already holds", () => {
  it("splits a location that was stored as one unplaceable key", async () => {
    const id = await storedRole(
      "1",
      "Hybrid - San Francisco Bay Area, CA / Seattle, WA",
      ["san francisco bay area, ca / seattle, wa"],
    );

    const moved = await renormalizeLocations(getDb());

    expect(moved).toBe(1);
    expect(await placesOf(id)).toEqual([
      "san francisco bay area, ca",
      "seattle, wa",
    ]);
  });

  it("splits a location whose places a word stood between", async () => {
    // The #113 catch-up reached the marks; a word between two places is the
    // same unplaceable key reached by a different spelling (#119), and the
    // same pass has to reach it without a re-Fetch.
    const id = await storedRole("1", "Denver, CO or Menlo Park, CA", [
      "denver, co or menlo park, ca",
    ]);

    expect(await renormalizeLocations(getDb())).toBe(1);
    expect(await placesOf(id)).toEqual(["denver, co", "menlo park, ca"]);
  });

  it("splits a location whose places a period stood between", async () => {
    // The third spelling of the same unplaceable key (#120), and the one the
    // period's trailing full stop used to leave on the last place.
    const id = await storedRole("1", "Fort Wayne, IN. Mooresville, IN.", [
      "fort wayne, in. mooresville, in.",
    ]);

    expect(await renormalizeLocations(getDb())).toBe(1);
    expect(await placesOf(id)).toEqual(["fort wayne, in", "mooresville, in"]);
  });

  it("moves a Posting off a country it was held on", async () => {
    // The key the geocoder answers with the centre of the country (#124). The
    // Posting named no place all along; the pass has to reach it in place,
    // because nothing else revisits an Expired row.
    const id = await storedRole("1", "Remote - United States", [
      "united states",
    ]);
    const list = await storedRole(
      "2",
      "Remote - United States / New Jersey / Boston / New York",
      ["united states", "new jersey", "boston", "new york"],
    );

    expect(await renormalizeLocations(getDb())).toBe(2);
    expect(await placesOf(id)).toEqual([]);
    // `new jersey` sat in this list until a state under a remote label read
    // as remote rather than as a place (#146).
    expect(await placesOf(list)).toEqual(["boston", "new york"]);
  });

  it("moves a Posting off a state it was held on", async () => {
    // The key the geocoder answers with the state's centroid (#146) — a point
    // in Worcester County that the radius measured a Boston User against.
    const remote = await storedRole("1", "Remote - Massachusetts", [
      "massachusetts",
    ]);
    const bare = await storedRole("2", "Louisiana; Texas", ["louisiana", "texas"]);
    const list = await storedRole(
      "3",
      "Dallas, Texas; Houston, Texas; Remote - Texas",
      ["dallas, texas", "houston, texas", "texas"],
    );

    expect(await renormalizeLocations(getDb())).toBe(3);
    expect(await placesOf(remote)).toEqual([]);
    expect(await placesOf(bare)).toEqual([]);
    expect(await placesOf(list)).toEqual(["dallas, texas", "houston, texas"]);
  });

  it("leaves a Posting already holding the right places alone", async () => {
    const id = await storedRole("1", "Boston, MA", ["boston, ma"]);

    expect(await renormalizeLocations(getDb())).toBe(0);
    expect(await placesOf(id)).toEqual(["boston, ma"]);
  });

  it("empties the places of a location that names none", async () => {
    const id = await storedRole("1", "Remote", ["remote"]);

    expect(await renormalizeLocations(getDb())).toBe(1);
    expect(await placesOf(id)).toEqual([]);
  });

  it("re-reads a Posting the old reading left with no places at all", async () => {
    const id = await storedRole("1", "Austin, TX", []);

    expect(await renormalizeLocations(getDb())).toBe(1);
    expect(await placesOf(id)).toEqual(["austin, tx"]);
  });
});
