import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** The database a connection string points at. */
export function databaseNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/**
 * The test database URL, resolved and checked.
 *
 * Asserted rather than defaulted so a missing value fails with an explanation
 * instead of connecting somewhere unintended, and name-checked so a
 * misconfigured URL cannot point the truncating fixture at real data.
 */
export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. See .env.test for the local default.",
    );
  }

  const name = databaseNameFromUrl(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}": its name must contain "test".`,
    );
  }

  return url;
}

/**
 * Empties every table in the `public` schema, including the harness's own.
 *
 * Runs before each test so a test never sees rows another one left behind.
 * Truncation rather than a wrapping transaction is what lets the code under
 * test open transactions of its own, which Fetch orchestration (#6) needs when
 * it claims tasks.
 *
 * Drizzle's migration bookkeeping lives in the `drizzle` schema, so it is out
 * of range here and migrations are not re-run between tests.
 */
export async function resetDatabase(): Promise<void> {
  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  if (tables.rows.length === 0) return;

  const identifiers = sql.join(
    tables.rows.map((row) => sql.identifier(row.tablename)),
    sql`, `,
  );
  await db.execute(sql`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
}
