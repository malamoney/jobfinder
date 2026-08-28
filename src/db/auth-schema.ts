import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The tables better-auth owns.
 *
 * Kept apart from `schema.ts` because the shape is not ours to design: these
 * mirror better-auth's own model definitions field for field, and the library
 * reads them by property name, so renaming anything here breaks it at runtime
 * rather than at compile time. `schema.ts` re-exports them, so drizzle-kit and
 * the query builder see one schema.
 *
 * Property names are therefore better-auth's (camelCase) while column names
 * stay snake_case like the rest of the database — drizzle maps between the two,
 * and only the property names are load-bearing.
 *
 * Ids are text rather than uuid because better-auth generates them itself.
 *
 * Authentication lives in this database rather than at a vendor precisely so
 * this table exists: Criteria (#8) and Review State (#10) can put real foreign
 * keys against a User, instead of storing a copy of someone else's identifier.
 */

/** A person with an account. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A User as stored. */
export type User = typeof user.$inferSelect;

/**
 * One logged-in browser.
 *
 * Deleted with its User, because a session outliving the account it belongs to
 * is a login that still works for someone who no longer exists.
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/** A session as stored. */
export type Session = typeof session.$inferSelect;

/**
 * How a User proves who they are.
 *
 * `password` holds better-auth's hash and only ever that; the plaintext is
 * hashed before it reaches the adapter, so nothing in this application ever
 * has it to store. The OAuth token columns are unused today and are here
 * because better-auth expects the model to be complete.
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Short-lived tokens better-auth issues, for flows nothing uses yet. */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
