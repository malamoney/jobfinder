/**
 * What the curated set looks like right now, and which of it has died.
 *
 *   pnpm boards:status
 *
 * Roughly one in six Slugs goes dead within a sampling window, so the set
 * decays and needs revalidating. This is the read half of that: it reports
 * every Board with what its last Fetch did, worst first, so the ones worth
 * disabling are at the top rather than buried in a list of hundreds.
 *
 * Read-only, like everything else run by hand here. Disabling a Board is a
 * decision, so it stays a deliberate act — edit the seed file, or call
 * `addBoard` with `enabled: false`.
 */
import { listBoards, type CuratedBoard } from "@/operations";
import { closeDb } from "@/db";

/** Worst first: failures, then never-swept, then the Boards that are fine. */
function byMostWorthLookingAt(a: CuratedBoard, b: CuratedBoard): number {
  return concern(b) - concern(a) || a.slug.localeCompare(b.slug);
}

function concern(board: CuratedBoard): number {
  if (board.lastFetch?.status === "failed") return 2;
  if (board.lastFetch === null) return 1;
  return 0;
}

async function main(): Promise<void> {
  const curated = [...(await listBoards())].sort(byMostWorthLookingAt);

  if (curated.length === 0) {
    console.log("The curated set is empty. Run `pnpm seed:boards`.");
    return;
  }

  const failing = curated.filter(
    (board) => board.lastFetch?.status === "failed",
  );
  const unswept = curated.filter((board) => board.lastFetch === null);
  const disabled = curated.filter((board) => !board.enabled);

  console.log(
    `${curated.length} Boards: ${failing.length} failing their last Fetch, ` +
      `${unswept.length} never swept, ${disabled.length} disabled.\n`,
  );

  for (const board of curated) {
    const state = board.enabled ? "        " : "disabled";
    const outcome = board.lastFetch
      ? `${board.lastFetch.status.padEnd(9)} ${board.lastFetch.finishedAt.toISOString().slice(0, 10)}`
      : "never swept         ";
    const why = board.lastFetch?.error
      ? `  ${board.lastFetch.error.slice(0, 60)}`
      : "";
    console.log(`  ${state}  ${board.slug.padEnd(30)}  ${outcome}${why}`);
  }
}

try {
  await main();
} finally {
  await closeDb();
}
