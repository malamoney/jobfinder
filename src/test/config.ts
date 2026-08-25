import { config } from "dotenv";

/**
 * Where the test harness's migrations live.
 *
 * Both `drizzle.test.config.ts` (which writes them) and `global-setup.ts`
 * (which applies them) read these. If the two disagreed, migrations would
 * silently re-run against a fresh bookkeeping table on every boot.
 */
export const TEST_MIGRATIONS_FOLDER = "drizzle/test";
export const TEST_MIGRATIONS_TABLE = "__drizzle_migrations_test";
export const TEST_MIGRATIONS_SCHEMA = "drizzle";

/** The application's own migrations, written by `drizzle.config.ts`. */
export const APP_MIGRATIONS_FOLDER = "drizzle";

/**
 * Loads the test environment.
 *
 * Values already in the environment win, which is how CI points the suite at
 * its service container without editing a file.
 */
export function loadTestEnv(): void {
  config({ path: ".env.test.local", quiet: true });
  config({ path: ".env.test", quiet: true });
}
