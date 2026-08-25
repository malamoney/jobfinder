import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let connection: { pool: Pool; db: Database; url: string } | undefined;

/**
 * The application's database handle.
 *
 * Lazy rather than module-scoped so `DATABASE_URL` is read at first use: the
 * test harness points it at the test database before any test file loads, and
 * Next.js builds without a database reachable at all.
 *
 * Neon is reached over the standard Postgres wire protocol through its pooled
 * connection string, so the same driver serves production, local development,
 * and the Postgres that tests run against.
 */
export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  // A changed URL means a different database, so drop the stale pool rather
  // than silently handing back a handle to the old one.
  if (connection && connection.url !== url) {
    const stale = connection.pool;
    connection = undefined;
    stale.end().catch(() => {
      // Closing a pool we have already abandoned; nothing to recover.
    });
  }

  if (!connection) {
    const pool = new Pool({ connectionString: url });
    connection = { pool, db: drizzle(pool, { schema }), url };
  }

  return connection.db;
}

/** Closes the pool. Tests call this on teardown; the app never needs to. */
export async function closeDb(): Promise<void> {
  if (!connection) return;
  const { pool } = connection;
  connection = undefined;
  await pool.end();
}
