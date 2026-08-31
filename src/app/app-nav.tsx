import Link from "next/link";
import { logOutAction } from "./actions";

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
 */

const LINKS = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "criteria", href: "/criteria", label: "Criteria" },
] as const;

type NavKey = (typeof LINKS)[number]["key"];

export function AppNav({ active }: { active?: NavKey }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-4 px-6">
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
                  ? "font-medium text-gray-900"
                  : "text-gray-500 hover:text-gray-900"
              }
            >
              {label}
            </Link>
          ))}

          <form action={logOutAction}>
            <button
              type="submit"
              className="text-gray-500 underline hover:text-gray-900"
            >
              Log out
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
}
