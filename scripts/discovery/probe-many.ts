import { probeBoard, type BoardAddress, type BoardProbe } from "@/operations";

/** How hard a probe run leans on a Source. */
export type ProbeManyOptions = {
  /**
   * How many candidates are in flight at once.
   *
   * A harvest runs to thousands of Slugs and each probe asks for a Board's
   * full descriptions, so this is the difference between a run that takes
   * minutes and one that takes hours — and, in the other direction, between
   * reading a public API and hammering it. Modest on purpose.
   */
  concurrency?: number;
  /** How long any one candidate may take before it is given up on. */
  timeoutMs?: number;
  /** Called as each candidate comes back, so a long run can show progress. */
  onProbed?: (probe: BoardProbe, done: number, total: number) => void;
};

const DEFAULT_CONCURRENCY = 8;

/**
 * Probes every candidate, a few at a time, and ranks what came back.
 *
 * Ranking is the point of the exercise: discovery hands back thousands of
 * Slugs and a human has to decide which are worth sweeping, so the ones with
 * the most open roles come first and the dead ones sink. The sampling in
 * `docs/research/job-sources.md` found a median of thirteen roles per Board
 * against a mean of fifty-four, so the order matters far more than the raw
 * list does.
 */
export async function probeCandidates(
  candidates: readonly BoardAddress[],
  options: ProbeManyOptions = {},
): Promise<BoardProbe[]> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs,
    onProbed,
  } = options;

  const probes: BoardProbe[] = new Array(candidates.length);
  let next = 0;
  let done = 0;

  // A fixed pool drawing from a shared cursor, rather than chunks worked in
  // lockstep: one slow Board would otherwise hold up everything queued beside
  // it while the rest of the pool sat idle. Not Workers in the glossary's
  // sense — there is no Run, no Fetch Task and no Claim here, just probes.
  const probers = Array.from(
    { length: Math.max(1, Math.min(concurrency, candidates.length)) },
    async () => {
      while (next < candidates.length) {
        const index = next++;
        const probe = await probeBoard(candidates[index], { timeoutMs });
        probes[index] = probe;
        onProbed?.(probe, ++done, candidates.length);
      }
    },
  );

  await Promise.all(probers);

  return probes.sort(byMostWorthPromoting);
}

/**
 * Most open roles first; anything that could not be read last.
 *
 * A live Board with nothing open still outranks a dead Slug — it is a real
 * company between hires, and worth keeping in the set.
 */
function byMostWorthPromoting(a: BoardProbe, b: BoardProbe): number {
  if ((a.error === null) !== (b.error === null)) return a.error ? 1 : -1;
  if (a.postings !== b.postings) return b.postings - a.postings;
  return a.slug.localeCompare(b.slug);
}
