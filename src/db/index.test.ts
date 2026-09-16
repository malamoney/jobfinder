import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "./index";

/**
 * The guardrail's verdict (`remote-database.ts`) is applied where the
 * connection is first opened (#156). Opening a pool does not connect — pg
 * dials on the first query — so these can point `getDb()` at a host that does
 * not exist and never reach the network.
 */

const REMOTE = "postgres://user:hunter2secret@db.example.invalid:5432/jobfinder";

// The pool is dropped between tests so each one reaches the verdict rather
// than the handle the previous test left cached for the same URL.
afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("opening the application's database handle", () => {
  it("refuses a remote host in next dev before any pool exists", () => {
    vi.stubEnv("DATABASE_URL", REMOTE);
    vi.stubEnv("NODE_ENV", "development");

    expect(() => getDb()).toThrow(/db\.example\.invalid/);
    expect(() => getDb()).toThrow(/ALLOW_REMOTE_DATABASE=1/);
    expect(() => getDb()).not.toThrow(/hunter2secret/);
  });

  it("warns once per process in a script, not once per use", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", REMOTE);
    vi.stubEnv("NODE_ENV", undefined);

    getDb();
    getDb();
    getDb();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("db.example.invalid");
    expect(warn.mock.calls[0][0]).not.toContain("hunter2secret");
  });

  it("is silent when ALLOW_REMOTE_DATABASE=1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", REMOTE);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_REMOTE_DATABASE", "1");

    expect(() => getDb()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("is silent about a local database even outside the test environment", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", undefined);
    expect(() => getDb()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
