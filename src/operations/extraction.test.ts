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
