import { unstable_cache } from "next/cache";
import { readMatchedPostings, type MatchedPosting } from "@/operations";

/**
 * Storing the matched Postings read (#155) between the events that change it:
 * the nightly sweep's match rebuild, a Fetch now, or a Criteria save.
 *
 * `@/operations` stays free of `next/cache` (ADR 0018), so the cache lives
 * here, beside the Dashboard page that reads it. The tag names are built by
 * the two functions below and nowhere else, so the cache site and every
 * invalidation site — the Criteria action (`updateTag` on the User's tag) and
 * the cron route (`revalidateTag` on the shared tag once a sweep finishes)
 * — cannot drift apart.
 */

/** The tag every cached entry carries, expired once for every User at once. */
export const MATCHED_POSTINGS_TAG = "dashboard-matched-postings";

/** The tag one User's own entry carries, expired by their own Criteria save. */
export function matchedPostingsUserTag(userId: string): string {
  return `${MATCHED_POSTINGS_TAG}:${userId}`;
}

/**
 * The shape `unstable_cache` takes: a function to cache, its extra key parts,
 * and the tag/revalidate options — and what it hands back, a function with the
 * same signature that serves the stored result until a tag expires it.
 *
 * Named so a test can hand in a stand-in with the same shape rather than the
 * platform's data cache (ADR 0018, "Testing Decisions").
 */
export type CachePrimitive = typeof unstable_cache;

/**
 * The matched Postings read (#154), served from the data cache between the
 * three events that change it rather than run against the database on every
 * Dashboard render, filter tab, and "Back to matches".
 *
 * `cache` defaults to the platform's `unstable_cache` and is a parameter so a
 * test can inject an in-memory stand-in and assert what a User or the
 * database would see: how many times the read reached the database, and
 * which events made it reach again. An entry the cache refuses to store — over
 * its per-item size limit — still returns what `readMatchedPostings` fetched;
 * every following render just misses again rather than the page failing.
 * Production `unstable_cache` does this by returning the value uncached; in
 * `next dev` it throws once the value is already computed (Next's
 * `IncrementalCache.set`, error `E1003`), so this catches that throw and falls
 * back to the value the read already produced rather than letting it surface.
 *
 * Logs one line in development saying whether this render reached the cache
 * or the database, and how many openings it held — the only production-log
 * behaviour this leaves unchanged.
 */
export async function readMatchedPostingsCached(
  userId: string,
  cache: CachePrimitive = unstable_cache,
): Promise<MatchedPosting[]> {
  let reachedDatabase = false;
  let computed: MatchedPosting[] | undefined;

  const cached = cache(
    async (forUser: string) => {
      reachedDatabase = true;
      computed = await readMatchedPostings(forUser);
      return computed;
    },
    [MATCHED_POSTINGS_TAG],
    { tags: [MATCHED_POSTINGS_TAG, matchedPostingsUserTag(userId)] },
  );

  let postings: MatchedPosting[];
  try {
    postings = await cached(userId);
  } catch (error) {
    // A failure before the read produced anything is a real error — the
    // database read itself failed, not the cache's storing of it — and gets
    // to propagate same as it would without a cache in front of it.
    if (computed === undefined) throw error;
    postings = computed;
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[dashboard] matched postings: ${reachedDatabase ? "database" : "cache"} (${postings.length} openings)`,
    );
  }

  return postings;
}
