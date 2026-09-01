"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
// Not "@/auth": that barrel reaches Postgres, and this runs in the browser.
// This module is the half with nothing behind it, which is what lets the same
// rules run here and on the server.
import {
  credentialsProblem,
  MIN_PASSWORD_LENGTH,
  type AuthOutcome,
} from "@/auth/credentials";

/**
 * The email-and-password form, which signing up and logging in share.
 *
 * One component because the two differ only in wording and in which action
 * they post to; two would be two places to fix an accessibility problem.
 */
type CredentialsFormProps = {
  heading: string;
  blurb: string;
  submitLabel: string;
  action: (
    previous: AuthOutcome | null,
    form: FormData,
  ) => Promise<AuthOutcome>;
  footer: { prompt: string; href: string; linkLabel: string };
  /** Signing up states the rule; logging in must not hint at it. */
  showPasswordRule?: boolean;
};

export function CredentialsForm({
  heading,
  blurb,
  submitLabel,
  action,
  footer,
  showPasswordRule = false,
}: CredentialsFormProps) {
  const [outcome, submit, pending] = useActionState<AuthOutcome | null, FormData>(
    action,
    null,
  );
  const [refused, setRefused] = useState<string | null>(null);

  /**
   * Checks what was typed against the same schema the server checks it with,
   * and only then posts. Not a substitute for the server's check — anyone can
   * post past this — but it is why a typo is answered instantly instead of
   * after a round trip.
   */
  function check(form: FormData): void {
    const problem = credentialsProblem(Object.fromEntries(form));
    setRefused(problem);
    if (problem) return;

    startTransition(() => submit(form));
  }

  const serverProblem = outcome && !outcome.ok ? outcome.message : null;
  const problem = refused ?? serverProblem;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-text-body">{blurb}</p>
      </div>

      {/* `noValidate` because the messages below are ours, in our wording,
          rather than whatever the browser would say in its own. */}
      <form action={check} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-border bg-field px-3 py-2 text-base"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            // Tells a password manager which of the two this is, so it offers
            // to generate on signup and to fill on login.
            autoComplete={showPasswordRule ? "new-password" : "current-password"}
            required
            className="rounded-md border border-border bg-field px-3 py-2 text-base"
          />
          {showPasswordRule && (
            <span className="text-xs text-label">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
          )}
        </label>

        {/*
          Announced rather than merely coloured: someone using a screen reader
          finds out the submission failed at the moment it does, and the
          message is the same sentence the server decided on.
        */}
        <p role="alert" aria-live="polite" className="text-sm text-danger">
          {problem}
        </p>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-accent-edge bg-accent-wash px-4 py-2 text-sm font-medium text-accent-text disabled:border-border disabled:bg-transparent disabled:text-label"
        >
          {pending ? "Working…" : submitLabel}
        </button>
      </form>

      <p className="text-sm text-text-body">
        {footer.prompt}{" "}
        <Link href={footer.href} className="font-medium underline">
          {footer.linkLabel}
        </Link>
      </p>
    </main>
  );
}
