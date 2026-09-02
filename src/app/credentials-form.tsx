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
import { MonoLabel } from "./mono-label";

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
    // Canvas 4e: a centered `--bg` card lit by a single radial glow — no border,
    // no fill of its own, just the wash bleeding down from above the wordmark.
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-card bg-bg px-8 py-12 [background-image:radial-gradient(500px_200px_at_50%_-70px,var(--accent-wash),transparent_70%)]">
        <div className="flex items-center gap-2 font-medium tracking-tight">
          <span
            aria-hidden
            className="brand-dot size-2 rounded-full bg-accent"
          />
          jobfinder
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight">{heading}</h1>
          <p className="text-[13.5px] text-label">{blurb}</p>
        </div>

        {/* `noValidate` because the messages below are ours, in our wording,
            rather than whatever the browser would say in its own. */}
        <form action={check} className="flex flex-col gap-4" noValidate>
          <label className="group flex flex-col gap-1.5">
            <MonoLabel className="group-focus-within:text-accent-text">
              Email
            </MonoLabel>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="rounded-control border border-border bg-field px-3 py-2 text-[13.5px] focus:border-accent-edge focus:outline-none focus:ring-[3px] focus:ring-accent-wash"
            />
          </label>

          <label className="group flex flex-col gap-1.5">
            <MonoLabel className="group-focus-within:text-accent-text">
              Password
            </MonoLabel>
            <input
              name="password"
              type="password"
              // Tells a password manager which of the two this is, so it offers
              // to generate on signup and to fill on login.
              autoComplete={
                showPasswordRule ? "new-password" : "current-password"
              }
              required
              className="rounded-control border border-border bg-field px-3 py-2 text-[13.5px] focus:border-accent-edge focus:outline-none focus:ring-[3px] focus:ring-accent-wash"
            />
            {showPasswordRule && (
              <span className="text-[12px] text-label">
                At least {MIN_PASSWORD_LENGTH} characters.
              </span>
            )}
          </label>

          {/*
            Announced rather than merely coloured: someone using a screen reader
            finds out the submission failed at the moment it does, and the
            message is the same sentence the server decided on.
          */}
          <p role="alert" aria-live="polite" className="text-[12.5px] text-danger">
            {problem}
          </p>

          <button
            type="submit"
            disabled={pending}
            className="rounded-control border border-accent-edge bg-accent-wash px-3.5 py-2 text-center text-[13px] font-medium text-accent-text disabled:border-border disabled:bg-transparent disabled:text-label"
          >
            {pending ? "Working…" : submitLabel}
          </button>
        </form>

        <p className="text-[12.5px] text-label">
          {footer.prompt}{" "}
          <Link href={footer.href} className="text-accent-text hover:underline">
            {footer.linkLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}
