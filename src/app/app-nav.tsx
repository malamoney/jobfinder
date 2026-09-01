import Link from "next/link";
import { logOutAction } from "./actions";
import { readTheme } from "./theme-server";
import { ThemeToggle } from "./theme-toggle";

/**
 * The navigation on every page behind a login.
 *
 * Server-rendered — just links and the log-out form — and `fixed` to the top,
 * so it stays put as the page scrolls. Before this, the only way off the
 * Criteria page was the browser's back button.
 *
 * Each page passes which entry it is (`active`), for the current-page marker; a
 * page with no entry of its own — a Posting — passes nothing. Pages that render
 * it leave room at the top (`pt-24`) so their content clears the bar.
 *
 * The inner container is the same `mx-auto max-w-6xl px-6` every page behind the
 * login uses for its own shell (ADR 0012), so the mark here and a page's content
 * share a left edge at every width.
 *
 * The right edge carries the LIGHT / DARK toggle (#79) and, next to it, a
 * placeholder avatar disc — where an account menu will go.
 */

const LINKS = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "criteria", href: "/criteria", label: "Criteria" },
] as const;

type NavKey = (typeof LINKS)[number]["key"];

export async function AppNav({ active }: { active?: NavKey }) {
  const theme = await readTheme();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-chrome/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          Jobfinder
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {LINKS.map(({ key, href, label }) => (
            <Link
              key={key}
              href={href}
              aria-current={active === key ? "page" : undefined}
              className={
                active === key
                  ? "font-medium text-text"
                  : "text-label hover:text-text"
              }
            >
              {label}
            </Link>
          ))}

          <form action={logOutAction}>
            <button
              type="submit"
              className="text-label underline hover:text-text"
            >
              Log out
            </button>
          </form>

          <ThemeToggle theme={theme} />

          {/* Placeholder for the account menu. */}
          <span
            aria-hidden
            className="size-7 shrink-0 rounded-full border border-border bg-field"
          />
        </div>
      </nav>
    </header>
  );
}
