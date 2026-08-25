import { getDb } from "@/db";
import { harnessProbe } from "@/db/test-schema";

/**
 * A miniature of the primary seam, existing only so the harness has real
 * operations to test through.
 *
 * These are shaped exactly like the operations that will live in
 * `src/operations` — they reach for `getDb()` and call `fetch` themselves,
 * carrying no test-shaped hole for a database or an HTTP client to be injected
 * through. A test declares what the Source returns with MSW, calls the write
 * operation, and asserts on what the read operation gives back.
 *
 * Nothing outside the harness imports these, and the table behind them never
 * reaches production. See `src/db/test-schema.ts`.
 */

/** Fetches a probe document from a Source and records what it returned. */
export async function recordProbeFrom(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Probe request failed with ${response.status}`);
  }

  const body = (await response.json()) as { name: string };
  await getDb().insert(harnessProbe).values({ name: body.name });
}

/** Reads back every recorded probe, newest last. */
export async function listProbeNames(): Promise<string[]> {
  const rows = await getDb().select().from(harnessProbe);
  return rows.map((row) => row.name);
}
