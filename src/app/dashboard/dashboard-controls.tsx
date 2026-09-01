"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fetchNowAction,
  runMatchingAction,
  type DashboardActionResult,
} from "./actions";

/** Shown when an action fails for a reason it did not give one for. */
const INFRA_FAILURE = "Something went wrong. Try again in a moment.";

/**
 * "Run matching now" and "Fetch new postings" (#17).
 *
 * Both run through a Server Action and then refresh the page, so what shows
 * always matches what the server did. A message — the outcome, or a cooldown
 * refusal — appears in place rather than navigating away.
 */
export function DashboardControls() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DashboardActionResult | null>(null);

  function run(action: () => Promise<DashboardActionResult>) {
    setResult(null);
    start(async () => {
      try {
        const outcome = await action();
        setResult(outcome);
        if (outcome.ok) router.refresh();
      } catch {
        setResult({ ok: false, message: INFRA_FAILURE });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(runMatchingAction)}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          Run matching now
        </button>
        <button
          type="button"
          onClick={() => run(fetchNowAction)}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          Fetch new postings
        </button>
      </div>
      {result && (
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
