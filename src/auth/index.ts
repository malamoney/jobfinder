/**
 * Authentication: the handle, the shared credential schema, and the two flows
 * a form calls.
 *
 * Server-side only. It re-exports the auth handle, which reaches Postgres, so
 * importing this from a client component pulls the database driver into the
 * browser bundle and the build fails. A form wants "@/auth/credentials", which
 * is the same schema and the same outcome type with nothing behind them.
 */

export { getAuth } from "./instance";
export {
  credentialsProblem,
  MIN_PASSWORD_LENGTH,
  type AuthOutcome,
} from "./credentials";
export { currentUser, logIn, logOut, signUp } from "./flows";
