import { z } from "zod";

/**
 * What a User types to sign up or log in.
 *
 * One schema, imported by both the form and the server handler, so the two
 * cannot drift into disagreeing about what is acceptable — a client that
 * accepts what the server rejects is a form that fails with no explanation.
 *
 * Strict: an unrecognised key is a rejection rather than something quietly
 * dropped. Nothing legitimate sends fields this does not name, so anything
 * that does is either a stale client or someone probing.
 */

/**
 * The shortest password accepted.
 *
 * Longer than better-auth's default of eight, and stated here rather than
 * configured in two places: `instance.ts` reads this same constant, so the rule
 * the form enforces is the rule the server enforces.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Said the way a person reads it, not the way a validator writes it. */
const EMAIL_MESSAGE = "Enter an email address, like you@example.com.";
const PASSWORD_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

export const credentials = z.strictObject({
  // Trimmed *before* validating. `z.email().trim()` reads as though it does
  // this and does not: the trim is a transform that runs after the check, so
  // a pasted address with a trailing space would simply be rejected.
  email: z.string().trim().pipe(z.email(EMAIL_MESSAGE)),
  password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_MESSAGE),
});

export type Credentials = z.infer<typeof credentials>;

/**
 * What signing up or logging in answered with.
 *
 * Lives here, in the half with no database behind it, because the form
 * renders it: anything a client component imports pulls its whole import
 * graph into the browser bundle, and `instance.ts` reaches Postgres.
 */
export type AuthOutcome = { ok: true } | { ok: false; message: string };

/**
 * The first thing that is wrong with what was typed, phrased for the person
 * who typed it, or nothing if it is all fine.
 *
 * One message rather than a list: a form that lights up every field at once
 * reads as a scolding, and the person can only fix one thing first anyway.
 */
export function credentialsProblem(input: unknown): string | null {
  const parsed = credentials.safeParse(input);
  if (parsed.success) return null;

  return parsed.error.issues[0]?.message ?? "Check what you have entered.";
}
