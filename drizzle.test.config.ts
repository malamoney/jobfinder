import { defineConfig } from "drizzle-kit";
import {
  loadTestEnv,
  TEST_MIGRATIONS_FOLDER,
  TEST_MIGRATIONS_SCHEMA,
  TEST_MIGRATIONS_TABLE,
} from "./src/test/config";

// Test-only migrations for `src/db/test-schema.ts`. Same tooling as the app
// config, separate output folder and migrations table, so the harness table
// never lands in a production migration.
loadTestEnv();

export default defineConfig({
  schema: "./src/db/test-schema.ts",
  out: `./${TEST_MIGRATIONS_FOLDER}`,
  dialect: "postgresql",
  migrations: {
    table: TEST_MIGRATIONS_TABLE,
    schema: TEST_MIGRATIONS_SCHEMA,
  },
  dbCredentials: {
    url: process.env.TEST_DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
