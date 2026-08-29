import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import {
  readCriteria,
  readDashboard,
  readLatestFetchRun,
  type DashboardFilter,
  type DashboardPosting,
  type FetchRunSummary,
} from "@/operations";
import { REVIEW_STATUSES, STATUS_LABELS } from "@/review/schema";
import { logOutAction } from "../actions";
import { formatDateTime, formatDay, formatSalary } from "../format";
import { DashboardControls } from "./dashboard-controls";

export const metadata: Metadata = { title: "Dashboard · Jobfinder" };

// Server Actions inherit the page's ceiling (`fetchNowAction`'s background
// sweep needs the room). 60s is safe on every Vercel plan.
export const maxDuration = 60;

/** The filters offered above the list, in the order they are shown. */
const FILTERS: { key: DashboardFilter | "open"; label: string }[] = [
  { key: "open", label: "Open" },
  ...REVIEW_STATUSES.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
  })),
  { key: "all", label: "All" },
];

/** The `?status=` values `readDashboard` understands. */
const FILTER_VALUES = new Set<string>([...REVIEW_STATUSES, "all"]);

/** The filter a `?status=` value names, or undefined for the default view. */
function parseFilter(raw: string | undefined): DashboardFilter | undefined {
  return raw && FILTER_VALUES.has(raw) ? (raw as DashboardFilter) : undefined;
}

/**
 * The Dashboard: every Posting matching the signed-in User's Criteria, on one
 * page, filterable by review Status.
 *
 * The User is checked on the server before anything renders. Matching has
 * already run — `saveCriteria` re-matches on every save and the nightly Fetch
 * re-matches after it collects — so this only reads what is there.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const signedIn = await currentUser(await headers());
  if (!signedIn) redirect("/login");

  const filter = parseFilter((await searchParams).status);

  const stated = await readCriteria(signedIn.id);
  const { postings, matchedCount, unreviewedCount } = stated
    ? await readDashboard(signedIn.id, filter)
    : { postings: [], matchedCount: 0, unreviewedCount: 0 };

  const lastFetch = await readLatestFetchRun();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <form action={logOutAction}>
            <button type="submit" className="text-sm text-gray-500 underline">
              Log out
            </button>
          </form>
        </div>
        <p className="text-sm text-gray-600">Signed in as {signedIn.email}.</p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
        <LastFetchLine fetch={lastFetch} />
        <DashboardControls />
      </section>

      {!stated ? (
        <Empty
          message="Tell Jobfinder what you are looking for, and the matches appear here."
          cta="State your criteria"
        />
      ) : matchedCount === 0 ? (
        <Empty
          message="Nothing in the corpus matches your criteria yet. New postings are collected every night."
          cta="Edit your criteria"
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                {unreviewedCount}
              </span>{" "}
              {unreviewedCount === 1 ? "posting" : "postings"} not yet reviewed
            </p>
            <Link href="/criteria" className="text-sm underline">
              Edit your criteria
            </Link>
          </div>

          <nav className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, label }) => {
              const active =
                key === "open" ? filter === undefined : filter === key;
              return (
                <Link
                  key={key}
                  href={key === "open" ? "/dashboard" : `/dashboard?status=${key}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {postings.length === 0 ? (
            <p className="text-sm text-gray-600">
              No postings under this filter.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {postings.map((posting) => (
                <PostingCard key={posting.id} posting={posting} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

/**
 * The last Fetch, so a User can tell "no new roles" from "the sweep broke"
 * (#17). A sweep in progress is noted without hiding the previous outcome, and
 * the failed Boards sit behind a disclosure — present when it matters, out of
 * the way when it does not.
 */
function LastFetchLine({ fetch }: { fetch: FetchRunSummary | null }) {
  if (!fetch) {
    return (
      <p className="text-sm text-gray-600">
        No fetch has run yet. The nightly sweep collects new postings at 3am.
      </p>
    );
  }

  const finished =
    fetch.finishedAt === null
      ? "The first fetch is running now."
      : `Last fetched ${formatDateTime(fetch.finishedAt)} · ${fetch.succeeded} of ${fetch.boardCount} boards`;

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="text-gray-600">
        {finished}
        {fetch.failed > 0 && (
          <span className="text-amber-700"> · {fetch.failed} failed</span>
        )}
        {fetch.running && (
          <span className="text-gray-500"> · another fetch is running</span>
        )}
      </p>
      {fetch.failures.length > 0 && (
        <details className="text-gray-600">
          <summary className="cursor-pointer text-amber-700">
            Boards that errored
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {fetch.failures.map((failure) => (
              <li key={`${failure.source}/${failure.slug}`}>
                <span className="font-medium text-gray-900">
                  {failure.source}/{failure.slug}
                </span>
                <span className="text-gray-500"> — {failure.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Shown when there is no statement of Criteria, or nothing matched it. */
function Empty({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-gray-300 p-6">
      <p className="text-sm text-gray-600">{message}</p>
      <Link
        href="/criteria"
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
      >
        {cta}
      </Link>
    </div>
  );
}

/** One matched Posting, triageable at a glance and a link to the full page. */
function PostingCard({ posting }: { posting: DashboardPosting }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/postings/${posting.id}`}
            className="font-medium text-gray-900 underline"
          >
            {posting.title}
          </Link>
          <span className="text-sm text-gray-600">{posting.company}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {posting.status !== "new" && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {STATUS_LABELS[posting.status]}
            </span>
          )}
          {posting.expired && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              Expired
            </span>
          )}
          {posting.unresolvedLocation && (
            // The radius could not be applied to this Posting — its location did
            // not geocode. Shown, not dropped, and marked so it is clear why
            // (#12).
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Location unresolved
            </span>
          )}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
        <Fact label="Location" value={posting.location ?? "Not given"} />
        {/* Extraction (#11) fills salary where the Posting's text states one; an
            unknown reads as "not listed", never a number or a zero (#36). */}
        <Fact label="Salary" value={formatSalary(posting)} />
        <Fact label="Posted" value={formatDay(posting.postedAt, "Date not given")} />
      </dl>

      {posting.matchedKeywords.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {posting.matchedKeywords.map((keyword) => (
            <li
              key={keyword}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
            >
              {keyword}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-gray-400">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
