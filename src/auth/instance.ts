import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import * as schema from "@/db/auth-schema";
import { MIN_PASSWORD_LENGTH } from "./credentials";

/**
 * Authentication, against this application's own Postgres.
 *
 * Deliberately not delegated to a hosted vendor: the User table is an ordinary
 * table in the same database as the Corpus, so Criteria (#8) and Review State
 * (#10) can put real foreign keys against it rather than storing a copy of
 * somebody else's opaque identifier and hoping it stays valid.
 */

/** How long a session lasts, and how a "remember me" is expressed. */
const SESSION_DAYS = 30;

/**
 * Refreshed at most once a day.
 *
 * A session that rewrote its own expiry on every request would write to the
 * database on every page load, to move a date that is thirty days out.
 */
const SESSION_REFRESH_HOURS = 24;

/**
 * The application's auth handle.
 *
 * Lazy for the same reason `getDb` is: the adapter needs a live database
 * handle, and building one at module scope would mean `next build` — which
 * runs in CI with no database reachable — failing on an import.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

/**
 * Written as a factory so the type below is the *configured* handle rather
 * than `betterAuth`'s generic default: the endpoints better-auth exposes
 * depend on which features are switched on here, and the wider type loses
 * them.
 */
function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),

    emailAndPassword: {
      enabled: true,
      // The same floor the form enforces, read from the same constant, so the
      // two cannot drift into disagreeing.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Straight in after signing up, rather than sending someone who just
      // typed their password to a login form to type it again.
      autoSignIn: true,
    },

    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: SESSION_REFRESH_HOURS * 60 * 60,
    },

    rateLimit: {
      // On everywhere, not just in production as better-auth defaults to.
      // A limit that only exists where it cannot be exercised is a limit
      // nobody finds out is broken.
      enabled: true,
      // In the database rather than in memory: the deployment target is
      // serverless, where an in-memory counter is per-invocation, so three
      // guesses per ten seconds would mean three per lambda instance.
      storage: "database",
    },

    // Pinned in production by #20. Unset, better-auth derives its origin from
    // the request's own Host header, which is fine locally and is not
    // something to rely on once deployed.
    baseURL: process.env.BETTER_AUTH_URL,

    // Writes the session cookie from a server action or route handler. Next
    // forbids setting cookies from a render, so without this a sign-in would
    // succeed and then appear not to have happened.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;
