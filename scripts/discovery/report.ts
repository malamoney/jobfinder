import type { BoardProbe } from "@/operations";

/**
 * What the two hand-run scripts have in common: a long wait, and a summary of
 * what came back. Both probe hundreds of Boards, and neither is worth watching
 * unless it says something while it works.
 */

/** Prints progress every so often, so a run of hundreds is not a silent wait. */
export function everyFew(interval = 25) {
  return (_probe: BoardProbe, done: number, total: number): void => {
    if (done % interval === 0 || done === total) {
      console.log(`  probed ${done}/${total}`);
    }
  };
}

/** The Boards that answered, and how much they are advertising between them. */
export function summarise(probes: readonly BoardProbe[]) {
  const live = probes.filter((probe) => probe.error === null);

  return {
    live,
    dead: probes.filter((probe) => probe.error !== null),
    postings: live.reduce((total, probe) => total + probe.postings, 0),
  };
}

/**
 * One Board as a human reads it: how much it is advertising, its Slug, and
 * enough of what it is advertising to judge whether it is worth sweeping.
 *
 * The titles are the part that matters. The curated set is meant to lean
 * towards the roles being searched for, and a count cannot tell a robotics
 * company from a staffing agency.
 */
export function describe(probe: BoardProbe): string {
  if (probe.error) {
    return `  dead  ${probe.slug}  ${probe.error.slice(0, 70)}`;
  }

  const count = String(probe.postings).padStart(4);
  const titles = probe.titles.slice(0, 3).join(" · ").slice(0, 90);
  return `  ${count}  ${probe.slug.padEnd(28)}  ${titles}`;
}
