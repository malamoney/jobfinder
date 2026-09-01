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
import { AppNav } from "../app-nav";
import { CompanyIcon } from "../company-icon";
import { cardLocation, formatAge, formatDateTime, formatSalary } from "../format";
import { PostingTags } from "../posting-tags";
import { readTheme } from "../theme-server";
import type { Theme } from "../theme";
import { DashboardControls } from "./dashboard-controls";
import { SavedToggle } from "./saved-toggle";

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

/**
 * The most matched Keywords a card shows before collapsing the rest into a
 * "+N" pill. A card is a triage glance, not the record — the full list is on
 * the Posting page — and an unbounded row of pills is the other thing (besides
 * the title) that pushes a card past its standard height (#75).
 */
const MAX_CARD_KEYWORDS = 6;

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
  const theme = await readTheme();

  const stated = await readCriteria(signedIn.id);
  const { postings, matchedCount, unreviewedCount } = stated
    ? await readDashboard(signedIn.id, filter)
    : { postings: [], matchedCount: 0, unreviewedCount: 0 };

  const lastFetch = await readLatestFetchRun();

  return (
    <>
      <AppNav active="dashboard" />
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-24">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-text-body">
            Signed in as {signedIn.email}.
          </p>
        </header>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
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
              <p className="text-sm text-text-body">
                <span className="font-mono font-semibold text-text">
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
                        ? "border-accent-edge bg-accent-wash text-accent-text"
                        : "border-border text-text-body"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>

            {postings.length === 0 ? (
              <p className="text-sm text-text-body">
                No postings under this filter.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {postings.map((posting) => (
                  <PostingCard
                    key={posting.id}
                    posting={posting}
                    theme={theme}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {/* Logo.dev's free tier asks for a link back where its logos are shown
            (ADR 0011). */}
        <footer className="mt-auto pt-4 text-xs text-label">
          Logos by{" "}
          <a
            href="https://logo.dev"
            className="underline hover:text-text-body"
            target="_blank"
            rel="noopener noreferrer"
          >
            Logo.dev
          </a>
          .
        </footer>
      </main>
    </>
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
      <p className="text-sm text-text-body">
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
      <p className="text-text-body">
        {finished}
        {fetch.failed > 0 && (
          <span className="text-warn"> · {fetch.failed} failed</span>
        )}
        {fetch.running && (
          <span className="text-label"> · another fetch is running</span>
        )}
      </p>
      {fetch.nonUsPruned > 0 && (
        // A one-time cleanup that trends to zero: roles stored before the corpus
        // went US-only (ADR 0010) are being removed a batch per sweep. The
        // steady-state count of foreign roles the sources still list and this
        // sweep skipped is on the run record but not shown — it never changes.
        <p className="text-label">
          Removed {fetch.nonUsPruned} non-US role
          {fetch.nonUsPruned === 1 ? "" : "s"} stored before the US-only change.
        </p>
      )}
      {fetch.failures.length > 0 && (
        <details className="text-text-body">
          <summary className="cursor-pointer text-warn">
            Boards that errored
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {fetch.failures.map((failure) => (
              <li key={`${failure.source}/${failure.slug}`}>
                <span className="font-mono font-medium text-text">
                  {failure.source}/{failure.slug}
                </span>
                <span className="text-label"> — {failure.error}</span>
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
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border p-6">
      <p className="text-sm text-text-body">{message}</p>
      <Link
        href="/criteria"
        className="rounded-md border border-accent-edge bg-accent-wash px-4 py-2 text-sm font-medium text-accent-text"
      >
        {cta}
      </Link>
    </div>
  );
}

/**
 * One matched Posting (#63): company mark and the Save toggle on top, the
 * company and how long ago it was posted, a large title linking to the full
 * review page, the Arrangement pills, then a divider and a footer — salary and
 * location on the left, Apply now on the right.
 *
 * The Jobfinder-only signals the generic design has no slot for still show:
 * Expired and an unresolved location sit among the pills (`PostingTags`), the
 * matched Keywords sit above the divider, and a Status past `interested`
 * (`applied` / `not_interested`) replaces the Save toggle with its own pill so
 * the card is never ambiguous about where the Posting sits.
 *
 * A row of cards is uneven otherwise (#75): a short card's Apply button sits
 * high, a long one's low, and the effect got worse as the redesign added rows
 * (salary, location, keywords) a plain fact list didn't have. Two rules fix
 * it — `min-h-80` gives every card a floor, and the footer's `mt-auto` pushes
 * it to the card's bottom so whatever slack a short card has collects between
 * the tags/keywords and the divider rather than trailing below the Apply
 * button.
 *
 * The two things that varied a card's height most are bounded so a row rarely
 * has to grow past the floor at all: the title is clamped to two lines
 * (`line-clamp-2`, full text on the Posting page it links to), and the matched
 * Keywords stop at `MAX_CARD_KEYWORDS` with a "+N" pill for the rest. A grid
 * row still stretches every `<li>` in it to the tallest, so a card that does
 * exceed the floor — many Arrangement tags, mostly — grows its row uniformly
 * rather than clipping.
 */
function PostingCard({
  posting,
  theme,
}: {
  posting: DashboardPosting;
  theme: Theme;
}) {
  const savable = posting.status === "new" || posting.status === "interested";

  return (
    <li className="flex min-h-80 flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <CompanyIcon
          // Keyed on the theme so a mark that hit `onError` in one palette gets
          // a fresh attempt at the other palette's URL rather than staying
          // collapsed to the monogram until a hard reload.
          key={theme}
          company={posting.company}
          theme={theme}
        />
        {savable ? (
          <SavedToggle
            // Keyed on the Status so a change reconciled in place (this card, or
            // another island's refresh) remounts the toggle against the server's
            // value rather than keeping a stale label.
            key={posting.status}
            postingId={posting.id}
            saved={posting.status === "interested"}
          />
        ) : (
          <span className="rounded-md border border-accent-edge bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-text">
            {STATUS_LABELS[posting.status]}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-text-body">{posting.company}</span>
          <span className="text-xs text-label">
            {formatAge(posting.postedAt)}
          </span>
        </div>
        <Link
          href={`/postings/${posting.id}`}
          title={posting.title}
          className="line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-text hover:underline"
        >
          {posting.title}
        </Link>
      </div>

      <PostingTags posting={posting} />

      {posting.matchedKeywords.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {posting.matchedKeywords.slice(0, MAX_CARD_KEYWORDS).map((keyword) => (
            <li
              key={keyword}
              className="rounded-full bg-tag px-2 py-0.5 text-xs text-text-body"
            >
              {keyword}
            </li>
          ))}
          {posting.matchedKeywords.length > MAX_CARD_KEYWORDS && (
            <li
              title={posting.matchedKeywords.join(", ")}
              className="rounded-full bg-tag px-2 py-0.5 font-mono text-xs text-label"
            >
              +{posting.matchedKeywords.length - MAX_CARD_KEYWORDS}
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          {/* Extraction (#11) fills salary where the Posting's text states one;
              an unknown reads as "not listed", never a number or a zero (#36). */}
          <span className="font-mono font-medium text-text">
            {formatSalary(posting)}
          </span>
          {/* `truncate` (not a hard-coded character count) keeps this one line
              at every grid width; `min-w-0` on the flex column above is what
              lets it actually shrink instead of pushing the card wider. A `/`-
              or `;`-joined list of offices collapses to "Multiple locations"
              first (`cardLocation`) — spelling all of them out is what broke a
              card's height worst. The full string is still a hover away. */}
          <span className="truncate text-text-body" title={posting.location ?? undefined}>
            {cardLocation(posting.location)}
          </span>
        </div>
        {posting.expired ? (
          // Every listing of this opening has come down (#7): the apply URL
          // 404s, so the card states that instead of sending the User to it.
          <span className="shrink-0 rounded-md border border-border px-4 py-2 text-sm font-medium text-disabled">
            Listing expired
          </span>
        ) : (
          <a
            href={posting.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-accent-edge bg-accent-wash px-4 py-2 text-sm font-medium text-accent-text"
          >
            Apply now
          </a>
        )}
      </div>
    </li>
  );
}
