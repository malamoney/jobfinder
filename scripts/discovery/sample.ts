/**
 * Takes a random subset, without favouring any part of the list.
 *
 * A harvest comes back sorted, and probing is bounded to a few hundred
 * candidates, so taking the first N would probe the alphabetical head — which
 * on Common Crawl is numerals and test Boards rather than companies. ADR 0003's
 * own yield figures came from "150 randomly sampled Greenhouse slugs", so a
 * random draw is also what makes a run's hit rate comparable to that number.
 *
 * Fisher-Yates over a copy: sorting by a random comparator is the usual
 * shortcut here and it is not uniform.
 */
export function sample<T>(items: readonly T[], count: number): T[] {
  const drawn = [...items];

  for (let i = drawn.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
  }

  return drawn.slice(0, Math.max(0, count));
}
