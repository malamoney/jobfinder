"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyTheme, type Theme } from "./theme";

/** Segment order, left to right — LIGHT then DARK (canvas 3a header). */
const SEGMENTS: readonly Theme[] = ["light", "dark"];

/**
 * The LIGHT / DARK control in the nav (#79, canvas 3a header).
 *
 * A segmented control: `--field` track, the active segment on the accent wash,
 * 10px mono labels. The current theme comes from the server (the cookie, read
 * in `AppNav`), so the right segment is lit on the first paint with no flash.
 *
 * A click does three things: flip `data-theme` on `<html>` at once so the
 * palette repaints immediately, write the cookie so the choice survives a
 * reload and a fresh tab, and `router.refresh()` so anything the server renders
 * from the cookie (the company marks, `format.companyIconSrc`) catches up.
 */
export function ThemeToggle({ theme }: { theme: Theme }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(next: Theme) {
    if (next === theme || pending) return;
    applyTheme(next);
    start(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border border-border bg-field p-0.5"
    >
      {SEGMENTS.map((option) => {
        const active = option === theme;
        return (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={active}
            className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              active
                ? "bg-accent-wash text-accent-text"
                : "text-label hover:text-text"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
