import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import {
  APP_MIGRATIONS_FOLDER,
  TEST_MIGRATIONS_FOLDER,
  TEST_MIGRATIONS_SCHEMA,
  TEST_MIGRATIONS_TABLE,
} from "./config";
import { databaseNameFromUrl, resolveTestDatabaseUrl } from "./database";

/**
 * Prepares the test database once per run: creates it if absent, then applies
 * the application migrations followed by the test-only ones.
 *
 * Migrations run here rather than per test file so the per-test cost is only
 * the truncate in `resetDatabase()`.
 */
export default async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  await createDatabaseIfMissing(url);

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool);

    // Guarded rather than assumed, so a checkout that has not generated
    // migrations yet still gets a usable test database.
    if (existsSync(`${APP_MIGRATIONS_FOLDER}/meta/_journal.json`)) {
      await migrate(db, { migrationsFolder: APP_MIGRATIONS_FOLDER });
    }

    // Kept in its own migrations table so it can never be confused for, or
    // collide with, the application's migration history.
    await migrate(db, {
      migrationsFolder: TEST_MIGRATIONS_FOLDER,
      migrationsTable: TEST_MIGRATIONS_TABLE,
      migrationsSchema: TEST_MIGRATIONS_SCHEMA,
    });
  } finally {
    await pool.end();
  }
}

/**
 * Creates the test database if it does not exist, so a fresh checkout needs
 * only a running Postgres and no manual `createdb`.
 */
async function createDatabaseIfMissing(url: string): Promise<void> {
  const databaseName = databaseNameFromUrl(url);

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised; the name is quoted instead, and
      // `resolveTestDatabaseUrl` has already constrained what it can be.
      await client.query(
        `CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`,
      );
    }
  } finally {
    await client.end();
  }
}
