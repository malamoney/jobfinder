"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchNowAction, type DashboardActionResult } from "./actions";

/** Shown when the action fails for a reason it did not give one for. */
const INFRA_FAILURE = "Something went wrong. Try again in a moment.";

/**
 * The "Filters" / "Run scan now" pair in the Dashboard header (canvas 3a).
 *
 * "Filters" jumps to the filter chip row (`#filters`) — shown only when there
 * is a row to jump to. "Run scan now" triggers a real Corpus sweep through a
 * Server Action, cooldown-guarded server-side, then refreshes so the kicker
 * reflects it. The outcome — started, or a cooldown refusal — appears under the
 * buttons rather than navigating away.
 */
export function DashboardControls({ showFilters }: { showFilters: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DashboardActionResult | null>(null);

  function runScan() {
    setResult(null);
    start(async () => {
      try {
        const outcome = await fetchNowAction();
        setResult(outcome);
        if (outcome.ok) router.refresh();
      } catch {
        setResult({ ok: false, message: INFRA_FAILURE });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        {showFilters && (
          <a
            href="#filters"
            className="rounded-control border border-border px-3.5 py-[7px] text-[12.5px] text-label hover:text-text"
          >
            Filters
          </a>
        )}
        <button
          type="button"
          onClick={runScan}
          disabled={pending}
          className="rounded-control border border-accent-edge bg-accent-wash px-3.5 py-[7px] text-[12.5px] font-medium text-accent-text disabled:border-border disabled:bg-transparent disabled:text-label"
        >
          {pending ? "Scanning…" : "Run scan now"}
        </button>
      </div>
      {result && (
        <p
          role="status"
          aria-live="polite"
          className={`max-w-xs text-right text-[12.5px] ${
            result.ok ? "text-ok" : "text-danger"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
