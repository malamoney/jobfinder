import { beforeEach, describe, expect, it, vi } from "vitest";
import { MATCHED_POSTINGS_TAG } from "../../../dashboard/matched-postings-cache";

/**
 * The sweep's invalidation of the matched Postings cache (#155): the shared
 * tag must expire exactly when `drainAndRematch` reports nothing remaining —
 * the moment `matchAllUsers` has already run — and not before.
 *
 * `next/cache` is mocked because `revalidateTag` throws outside a real Route
 * Handler request. `@/operations` is mocked down to the one function this
 * module calls, so the assertion is about `advanceSweep`'s own behaviour
 * rather than a real drain, which is Postgres-backed and exercised by its own
 * tests elsewhere.
 */

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag }));

const { drainAndRematch } = vi.hoisted(() => ({ drainAndRematch: vi.fn() }));
vi.mock("@/operations", () => ({ drainAndRematch }));

import { advanceSweep } from "./sweep";

beforeEach(() => {
  revalidateTag.mockClear();
  drainAndRematch.mockReset();
  delete process.env.CRON_SECRET;
});

describe("advanceSweep", () => {
  it("expires the shared matched-Postings tag once the queue drains", async () => {
    drainAndRematch.mockResolvedValue({ remaining: 0 });

    await advanceSweep("https://example.com");

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(MATCHED_POSTINGS_TAG, {
      expire: 0,
    });
  });

  it("does not expire the tag while Fetch Tasks remain queued", async () => {
    drainAndRematch.mockResolvedValue({ remaining: 3 });

    await advanceSweep("https://example.com");

    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
