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
 * it leave room at the top (`pt-20`) so their content clears the 52px bar.
 *
 * The inner container is the same `mx-auto max-w-6xl px-6` every page behind the
 * login uses for its own shell (ADR 0012), so the mark here and a page's content
 * share a left edge at every width.
 *
 * The look is canvas 3a / 3b (#80): a 52px `--chrome` bar with one `--border`
 * hairline under it — no translucency, no blur. The brand is an `--accent` dot
 * with a soft glow next to "jobfinder"; the links read as tabs, the active one
 * on a `--tag` chip. (#80 names `--field` for the chip, but that token is white
 * in the light theme — the same colour as `--chrome` — so the active tab would
 * vanish there; `--tag` is the chip colour canvas 3b actually uses and it reads
 * in both themes.) The right edge carries the LIGHT / DARK toggle (#79) and a
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
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-chrome">
      <nav className="mx-auto flex h-[52px] max-w-6xl items-center justify-between gap-3 px-6">
        <div className="flex items-center gap-3 sm:gap-7">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2 font-medium tracking-tight"
          >
            <span aria-hidden className="brand-dot size-2 rounded-full bg-accent" />
            jobfinder
          </Link>

          <div className="flex items-center gap-0.5 text-[13px] sm:gap-1">
            {LINKS.map(({ key, href, label }) => (
              <Link
                key={key}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={
                  active === key
                    ? "rounded-md bg-tag px-2 py-1 text-text sm:px-2.5"
                    : "rounded-md px-2 py-1 text-label hover:text-text sm:px-2.5"
                }
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
          <form action={logOutAction}>
            <button
              type="submit"
              className="text-[13px] text-label hover:text-text"
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
