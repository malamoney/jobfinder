import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { closeDb } from "@/db";
import { resetDatabase, resolveTestDatabaseUrl } from "./database";
import { server } from "./msw";

// Point the application's database handle at the test database. This runs
// before any test module is imported, and `getDb()` reads the variable lazily,
// so code under test reaches the test database without knowing it is in a test.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await closeDb();
});
