import { AppNav } from "../app-nav";

/**
 * The Dashboard's loading state (#81, canvas 4g).
 *
 * Next renders this in place of `page.tsx` while the server component is still
 * resolving — the User's Criteria, their Matches, and the latest Fetch run are
 * three database reads. The nav is kept so the chrome does not flash, and the
 * body mirrors the real page's shape — header line, stat strip, a grid of three
 * cards — so the layout does not jump when the data arrives.
 */
export default function DashboardLoading() {
  return (
    <>
      <AppNav active="dashboard" />
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-20">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          {/* Stands in for the "Signed in as …" line the loaded page renders,
              so the content below keeps its vertical position. */}
          <span
            aria-hidden
            className="h-4 w-52 animate-pulse rounded bg-border"
          />
        </header>

        <div className="flex animate-pulse flex-col gap-6" aria-hidden>
          <div className="grid grid-cols-3 overflow-hidden rounded-card border border-border bg-surface">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`flex flex-col gap-2.5 px-4 py-4 sm:px-[18px] ${
                  i > 0 ? "border-l border-hairline" : ""
                }`}
              >
                <span className="h-6 w-10 rounded bg-border" />
                <span className="h-2 w-20 rounded bg-border" />
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>

        <p role="status" className="micro-label mt-auto pt-4">
          Loading matches
        </p>
      </main>
    </>
  );
}

/** One placeholder card, shaped like a `PostingCard` before its data lands. */
function SkeletonCard() {
  return (
    <div className="flex min-h-80 flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between">
        <span className="size-[34px] rounded-control bg-border" />
        <span className="h-6 w-16 rounded-control bg-border" />
      </div>
      <span className="h-2 w-1/2 rounded bg-border" />
      <span className="h-4 w-4/5 rounded bg-border" />
      <span className="h-4 w-2/5 rounded-full bg-border" />
      <div className="mt-auto flex items-end justify-between border-t border-hairline pt-3">
        <span className="h-3 w-2/5 rounded bg-border" />
        <span className="h-8 w-20 rounded-control bg-border" />
      </div>
    </div>
  );
}
