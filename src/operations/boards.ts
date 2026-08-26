import { getDb } from "@/db";
import { boards } from "@/db/schema";
import type { Board } from "./fetch-board";

/** A Board to sweep, and whether the sweep should currently include it. */
export type BoardEntry = Board & { enabled?: boolean };

/**
 * Puts a Board into the curated set, or updates the one already there.
 *
 * Keyed on the Board's address rather than on a row id, so re-running a seed
 * (#18) is not a way to end up sweeping the same Board twice. A Board that
 * dies is disabled rather than removed — deleting it would only let the next
 * discovery run rediscover the Slug and add it back.
 */
export async function addBoard(board: BoardEntry): Promise<void> {
  const enabled = board.enabled ?? true;

  await getDb()
    .insert(boards)
    .values({ source: board.source, slug: board.slug, enabled })
    .onConflictDoUpdate({
      target: [boards.source, boards.slug],
      set: { enabled },
    });
}
