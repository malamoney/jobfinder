/**
 * The Sources discovery can harvest, keyed by the name `pnpm discover
 * --source` takes.
 *
 * Greenhouse plus the four other ATS Sources whose adapters landed in #14.
 * The aggregators (USAJOBS, Himalayas) have nothing to harvest — they are one
 * feed each, reached by keyword — and Workday is a hand-picked tenant list
 * with no harvesting path by design (ADR 0003).
 */
import { ashby } from "./ashby-slugs";
import type { SlugSource } from "./common-crawl";
import { greenhouse } from "./greenhouse-slugs";
import { lever } from "./lever-slugs";
import { recruitee } from "./recruitee-slugs";
import { workable } from "./workable-slugs";

export const DISCOVERY_SOURCES = {
  greenhouse,
  lever,
  ashby,
  workable,
  recruitee,
} as const satisfies Record<string, SlugSource>;

/** A Source name `pnpm discover --source` accepts. */
export type DiscoverableSource = keyof typeof DISCOVERY_SOURCES;

/** What `--source` defaults to when it is not passed — Greenhouse, as before. */
export const DEFAULT_SOURCE: DiscoverableSource = "greenhouse";

/**
 * The `SlugSource` for a `--source` value, or a thrown error naming what is on
 * offer. A typo here should stop the run at once, not harvest Greenhouse by
 * surprise.
 */
export function discoverySourceFor(name: string): SlugSource {
  // `Object.hasOwn`, not `name in`: `in` walks the prototype, so `--source
  // constructor` would slip past this and crash further downstream.
  if (Object.hasOwn(DISCOVERY_SOURCES, name)) {
    return DISCOVERY_SOURCES[name as DiscoverableSource];
  }
  throw new Error(
    `unknown --source "${name}"; one of: ${Object.keys(DISCOVERY_SOURCES).join(", ")}`,
  );
}
