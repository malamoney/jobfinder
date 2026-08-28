/**
 * Authentication: the handle, the shared credential schema, and the two flows
 * a form calls.
 *
 * Server-side only. It re-exports the auth handle, which reaches Postgres, so
 * importing this from a client component pulls the database driver into the
 * browser bundle and the build fails. A form wants "@/auth/credentials", which
 * is the same schema and the same outcome type with nothing behind them.
 */

export { getAuth, resetAuth } from "./instance";
export {
  credentials,
  credentialsProblem,
  MIN_PASSWORD_LENGTH,
  type AuthOutcome,
  type Credentials,
} from "./credentials";
export { logIn, signUp } from "./flows";
