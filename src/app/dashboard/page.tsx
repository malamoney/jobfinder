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
import { cardLocation, formatAge, formatDay, formatSalary } from "../format";
import { PostingTags } from "../posting-tags";
import { readTheme } from "../theme-server";
import type { Theme } from "../theme";
import { DashboardControls } from "./dashboard-controls";
import { RefreshMatches } from "./refresh-matches";
import { SavedToggle } from "./saved-toggle";

export const metadata: Metadata = { title: "Matches · Jobfinder" };

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
  const { postings, matchedCount, unreviewedCount, newTodayCount } = stated
    ? await readDashboard(signedIn.id, filter)
    : { postings: [], matchedCount: 0, unreviewedCount: 0, newTodayCount: 0 };

  const lastFetch = await readLatestFetchRun();

  return (
    <>
      <AppNav active="dashboard" />
      <RefreshMatches />
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-20">
        {/* Canvas 3a: a mono fetch kicker over a weight-500 title, with the
            "Filters" / "Run scan now" pair on the right. The kicker carries the
            sweep facts #17 needs (how many boards, when, what failed); the old
            `--surface` status panel and the separate "Run matching now" button
            are folded away — matching already re-runs on every Criteria save
            and after the nightly Fetch. */}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex flex-col gap-2.5">
            <FetchKicker fetch={lastFetch} newToday={newTodayCount} />
            <h1 className="text-[27px] font-medium leading-tight tracking-tight">
              Matches for review
            </h1>
          </div>
          <DashboardControls />
        </header>

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
            <StatStrip
              newToday={newTodayCount}
              matched={matchedCount}
              unreviewed={unreviewedCount}
            />

            <nav className="flex flex-wrap gap-2">
              {FILTERS.map(({ key, label }) => {
                const active =
                  key === "open" ? filter === undefined : filter === key;
                return (
                  <Link
                    key={key}
                    href={key === "open" ? "/dashboard" : `/dashboard?status=${key}`}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full border px-3.5 py-1.5 text-[13px] ${
                      active
                        ? "border-accent-edge bg-accent-wash text-accent-text"
                        : "border-border text-label"
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

        <footer className="mt-auto flex flex-col gap-2 pt-4 text-label">
          {/* The status line, canvas 3a: the count on the left, the privacy
              line on the right, both mono micro-labels. The list is ordered by
              posted date, newest first (`readDashboard`) — the mockup's "sorted
              by score" names a ranking the matcher does not compute. */}
          {matchedCount > 0 && (
            <div className="micro-label flex items-center justify-between gap-4">
              <span>
                Showing {postings.length} of {matchedCount} · Sorted by date
              </span>
              <span>All data stays in your account</span>
            </div>
          )}
          {/* Logo.dev's free tier asks for a link back where its logos are
              shown (ADR 0011). */}
          <p className="text-xs">
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
          </p>
        </footer>
      </main>
    </>
  );
}

/**
 * The mono kicker over the Dashboard title (canvas 3a): today's new matches,
 * then the facts a User needs to tell "no new roles" from "the sweep broke"
 * (#17) — how many Boards the last sweep covered and when it finished. A sweep
 * running now is called out, and failed Boards sit behind a disclosure so the
 * line stays short until something is actually wrong.
 */
function FetchKicker({
  fetch,
  newToday,
}: {
  fetch: FetchRunSummary | null;
  newToday: number;
}) {
  const parts = [`${newToday} new`];
  if (!fetch) {
    parts.push("no sweep yet");
  } else {
    parts.push(`${fetch.boardCount} boards swept`);
    parts.push(
      fetch.finishedAt
        ? `last sweep ${formatDay(fetch.finishedAt)}`
        : "first sweep running",
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2">
        <p className="micro-label">{parts.join(" · ")}</p>
        {fetch?.running && fetch.finishedAt && (
          <span className="micro-label text-accent-text">· sweeping now</span>
        )}
      </div>
      {fetch && fetch.failures.length > 0 && (
        // Its own line below the facts, so opening it never reflows the kicker.
        <details className="group">
          <summary className="micro-label cursor-pointer list-none text-warn marker:content-none">
            {fetch.failed} failed{" "}
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-[12.5px]">
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

/**
 * Shown when there is no statement of Criteria, or nothing matched it. Canvas
 * 4g: a dashed panel led by a mono micro-label, the explanation in `--text-body`,
 * and one outline call to action.
 */
function Empty({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-3.5 rounded-card border border-dashed border-border bg-surface p-6">
      <p className="micro-label">No matches yet</p>
      <p className="max-w-md text-sm text-text-body">{message}</p>
      <Link
        href="/criteria"
        className="rounded-control border border-accent-edge bg-accent-wash px-4 py-2 text-sm font-medium text-accent-text"
      >
        {cta}
      </Link>
    </div>
  );
}

/**
 * The three-up stat strip above the list (#81, canvas 3a): big mono numbers on
 * a `--surface` panel split by `--hairline` rules, each under a mono uppercase
 * caption.
 *
 * Canvas 3a leads with NEW TODAY / POSTINGS SCANNED / PASSED FILTER. Only the
 * first is a figure the app actually holds — no run record counts how many
 * Postings a sweep examined, so a per-User "scanned" figure and the ratio off
 * it would need new bookkeeping (`readLatestFetchRun` carries board counts,
 * not Posting counts). The two that stand in — the total match count and the
 * unreviewed count — are the numbers a User opening the page is deciding on.
 */
function StatStrip({
  newToday,
  matched,
  unreviewed,
}: {
  newToday: number;
  matched: number;
  unreviewed: number;
}) {
  const stats: { value: number; caption: string }[] = [
    { value: newToday, caption: "New today" },
    { value: matched, caption: "Matches" },
    { value: unreviewed, caption: "Unreviewed" },
  ];

  return (
    <dl className="grid grid-cols-3 overflow-hidden rounded-card border border-border bg-surface">
      {stats.map(({ value, caption }, index) => (
        <div
          key={caption}
          className={`flex flex-col-reverse gap-2 px-4 py-4 sm:px-[18px] ${
            index > 0 ? "border-l border-hairline" : ""
          }`}
        >
          <dt className="micro-label">{caption}</dt>
          <dd className="font-mono text-2xl font-medium leading-none text-text">
            {value}
          </dd>
        </div>
      ))}
    </dl>
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
    <li className="job-card flex min-h-80 flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <CompanyIcon
          // Keyed on the theme so a mark that hit `onError` in one palette gets
          // a fresh attempt at the other palette's URL rather than staying
          // collapsed to the monogram until a hard reload.
          key={theme}
          company={posting.company}
          theme={theme}
        />
        <div className="flex flex-wrap items-start justify-end gap-2">
          {/* A passive "already looked at this one" marker, left of the Save
              control — the `--disabled` tone the "Expired" tag wears. */}
          {posting.viewed && (
            <span className="rounded-control border border-border px-2.5 py-1 text-xs font-medium text-disabled">
              Viewed
            </span>
          )}
          {savable ? (
            <SavedToggle
              // Keyed on the Status so a change reconciled in place (this card,
              // or another island's refresh) remounts the toggle against the
              // server's value rather than keeping a stale label.
              key={posting.status}
              postingId={posting.id}
              saved={posting.status === "interested"}
            />
          ) : (
            <span className="rounded-control border border-accent-edge bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-text">
              {STATUS_LABELS[posting.status]}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-label">
          <span>{posting.company}</span>
          <span>{formatAge(posting.postedAt)}</span>
        </div>
        <Link
          href={`/postings/${posting.id}`}
          title={posting.title}
          className="line-clamp-2 text-[17px] font-medium leading-snug tracking-tight text-text hover:underline"
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
              className="rounded-full bg-tag px-2.5 py-[3px] font-mono text-[11px] text-text-body"
            >
              {keyword}
            </li>
          ))}
          {posting.matchedKeywords.length > MAX_CARD_KEYWORDS && (
            <li
              title={posting.matchedKeywords.join(", ")}
              className="rounded-full bg-tag px-2.5 py-[3px] font-mono text-[11px] text-label"
            >
              +{posting.matchedKeywords.length - MAX_CARD_KEYWORDS}
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px]">
          {/* Extraction (#11) fills salary where the Posting's text states one;
              an unknown reads as "not listed", never a number or a zero (#36). */}
          <span className="font-mono text-[13px] font-medium text-text">
            {formatSalary(posting)}
          </span>
          {/* `truncate` (not a hard-coded character count) keeps this one line
              at every grid width; `min-w-0` on the flex column above is what
              lets it actually shrink instead of pushing the card wider. A `/`-
              or `;`-joined list of offices collapses to "Multiple locations"
              first (`cardLocation`) — spelling all of them out is what broke a
              card's height worst. The full string is still a hover away. */}
          <span className="truncate text-label" title={posting.location ?? undefined}>
            {cardLocation(posting.location)}
          </span>
        </div>
        {posting.expired ? (
          // Every listing of this opening has come down (#7): the apply URL
          // 404s, so the card states that instead of sending the User to it.
          <span className="shrink-0 rounded-control border border-border px-3.5 py-[7px] text-[12.5px] font-medium text-disabled">
            Listing expired
          </span>
        ) : (
          <a
            href={posting.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-control border border-accent-edge bg-accent-wash px-3.5 py-[7px] text-[12.5px] font-medium text-accent-text"
          >
            Apply now
          </a>
        )}
      </div>
    </li>
  );
}
