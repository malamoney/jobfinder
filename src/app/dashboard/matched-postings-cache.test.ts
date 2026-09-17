import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { signUp } from "@/auth";
import { getDb } from "@/db";
import { user } from "@/db/schema";
import {
  addBoard,
  fetchBoard,
  overlayReviewState,
  saveCriteria,
  setStatus,
  type Board,
} from "@/operations";
import { boardReturns, greenhouseJob } from "@/test/fixtures/greenhouse";
import {
  MATCHED_POSTINGS_TAG,
  matchedPostingsUserTag,
  readMatchedPostingsCached,
  type CachePrimitive,
} from "./matched-postings-cache";

/**
 * The cache seam #155 adds: whatever `unstable_cache` would do, driven here
 * with an in-memory stand-in so the assertions are about what a User or the
 * database sees — how many times the matched Postings read reached the
 * database, and which events made it reach again — never about the platform
 * cache's own internals (spec, "Testing Decisions").
 */

type Entry = { value: unknown; tags: string[] };

/**
 * A stand-in for `unstable_cache`: same shape (a function to cache, its key
 * parts, and tag/revalidate options, back a function with that signature),
 * kept in memory and invalidated by tag rather than by time.
 *
 * `maxEntrySize`, when given, mimics the data cache refusing an over-limit
 * entry (spec, "Size"): the computed value is still returned, but never
 * stored, so the next call misses again rather than the page failing.
 */
function createTestCache(maxEntrySize = Infinity) {
  const store = new Map<string, Entry>();
  let misses = 0;

  const cache = ((
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[] = [],
    options: { tags?: string[] } = {},
  ) => {
    return async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args]);
      const hit = store.get(key);
      if (hit) return hit.value;

      misses += 1;
      const value = await fn(...args);
      const serialized = JSON.stringify(value);
      if (serialized.length <= maxEntrySize) {
        store.set(key, { value, tags: options.tags ?? [] });
      }
      return value;
    };
  }) as unknown as CachePrimitive;

  return {
    cache,
    missCount: () => misses,
    invalidateTag(tag: string): void {
      for (const [key, entry] of store) {
        if (entry.tags.includes(tag)) store.delete(key);
      }
    },
  };
}

const PASSWORD = "correct-horse-battery-staple";

async function givenAUser(email: string): Promise<string> {
  const outcome = await signUp(
    { email, password: PASSWORD },
    new Headers({ host: "localhost:3000" }),
  );
  if (!outcome.ok) throw new Error(`Could not seed a User: ${outcome.message}`);

  const [row] = await getDb().select().from(user).where(eq(user.email, email));
  return row.id;
}

let acme: Board;

beforeEach(async () => {
  acme = await addBoard({ source: "greenhouse", slug: "acme" });
  boardReturns("acme", [greenhouseJob({ id: 1, title: "Staff Engineer" })]);
  await fetchBoard(acme);
});

/** A User whose Criteria match the one Posting the Board fetched above. */
async function givenAMatchedUser(email: string): Promise<string> {
  const userId = await givenAUser(email);
  await saveCriteria(userId, {
    titles: ["Engineer"],
    keywords: [],
    arrangements: ["full-time", "remote"],
  });
  return userId;
}

describe("the matched Postings cache", () => {
  it("reaches the database once for two reads of the same User", async () => {
    const userId = await givenAMatchedUser("ada@example.com");
    const { cache, missCount } = createTestCache();

    await readMatchedPostingsCached(userId, cache);
    await readMatchedPostingsCached(userId, cache);

    expect(missCount()).toBe(1);
  });

  it("reaches it again after that User's own tag is invalidated, and not before", async () => {
    const ada = await givenAMatchedUser("ada@example.com");
    const grace = await givenAMatchedUser("grace@example.com");
    const { cache, missCount, invalidateTag } = createTestCache();

    await readMatchedPostingsCached(ada, cache);
    await readMatchedPostingsCached(grace, cache);
    expect(missCount()).toBe(2);

    // A Criteria save for Ada — `updateTag` on Ada's own tag.
    invalidateTag(matchedPostingsUserTag(ada));

    await readMatchedPostingsCached(ada, cache);
    expect(missCount()).toBe(3);

    // Grace's own entry is untouched by Ada's save.
    await readMatchedPostingsCached(grace, cache);
    expect(missCount()).toBe(3);
  });

  it("reaches it again for every User once the sweep's shared tag is invalidated", async () => {
    const ada = await givenAMatchedUser("ada@example.com");
    const grace = await givenAMatchedUser("grace@example.com");
    const { cache, missCount, invalidateTag } = createTestCache();

    await readMatchedPostingsCached(ada, cache);
    await readMatchedPostingsCached(grace, cache);
    expect(missCount()).toBe(2);

    // The nightly sweep, once `drainAndRematch` reports nothing remaining.
    invalidateTag(MATCHED_POSTINGS_TAG);

    await readMatchedPostingsCached(ada, cache);
    await readMatchedPostingsCached(grace, cache);
    expect(missCount()).toBe(4);
  });

  it("changes a card's Status without the matched Postings read reaching the database", async () => {
    const userId = await givenAMatchedUser("ada@example.com");
    const { cache, missCount } = createTestCache();

    const matched = await readMatchedPostingsCached(userId, cache);
    expect(missCount()).toBe(1);
    const postingId = matched[0].id;

    await setStatus(userId, postingId, "interested");

    // The overlay re-reads Review State live, but the matched Postings half
    // is still served from the cache — the read a review action must not cost.
    const cachedAgain = await readMatchedPostingsCached(userId, cache);
    expect(missCount()).toBe(1);

    const dashboard = await overlayReviewState(cachedAgain, userId, "all");
    expect(dashboard.postings[0].status).toBe("interested");
  });

  it("falls back to a database read that still renders when the cache refuses an entry", async () => {
    const userId = await givenAMatchedUser("ada@example.com");
    // Small enough that even one Posting's facts never fit.
    const { cache, missCount } = createTestCache(1);

    const first = await readMatchedPostingsCached(userId, cache);
    const second = await readMatchedPostingsCached(userId, cache);

    // Never cached, so every read reaches the database — and still renders.
    expect(missCount()).toBe(2);
    expect(second).toEqual(first);
    const dashboard = await overlayReviewState(second, userId, "all");
    expect(dashboard.matchedCount).toBe(1);
  });

  it("still renders when the cache primitive throws after computing the value", async () => {
    const userId = await givenAMatchedUser("ada@example.com");
    // `next dev`'s own `unstable_cache` does exactly this for an over-limit
    // entry — throws once the wrapped function has already returned a value,
    // rather than production's warn-and-return-uncached (spec, "Size").
    const throwsAfterComputing = ((
      fn: (...args: unknown[]) => Promise<unknown>,
    ) => {
      return async (...args: unknown[]) => {
        await fn(...args);
        throw new Error("items over 2MB can not be cached");
      };
    }) as unknown as CachePrimitive;

    const postings = await readMatchedPostingsCached(
      userId,
      throwsAfterComputing,
    );

    expect(postings).toHaveLength(1);
    const dashboard = await overlayReviewState(postings, userId, "all");
    expect(dashboard.matchedCount).toBe(1);
  });
});
