import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A table that exists only so the test harness has something to write to.
 *
 * It lives in its own schema file and its own migration folder (`drizzle/test`)
 * so it never reaches Neon. #4 and #5 add real tables to `src/db/schema.ts`;
 * nothing here is production schema.
 */
export const harnessProbe = pgTable("harness_probe", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
