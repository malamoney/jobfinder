"use client";

import { useId, useRef, useState } from "react";
// Not "@/operations": that reaches Postgres. These are the schema halves, with
// nothing behind them.
import { radiusVerdict, type CommuteDetails as Commute } from "@/commute/schema";
import { STATUS_LABELS, type PostingReview } from "@/review/schema";
import { formatDay } from "../../format";
import { MonoLabel } from "../../mono-label";
import { CommuteDetails } from "./commute-details";
import { ReviewControls } from "./review-controls";

/**
 * The panel under a Posting's header: the User's review, and — on a Posting
 * they would have to travel to — the commute beside it (#101, canvas 4a / 5a).
 *
 * The tab strip exists only when there is a second tab to reach. A Posting the
 * commute radius does not act on for this User — which depends on their stance
 * on remote, not on the Posting's text alone (ADR 0013, #112) — or one whose
 * location never resolved, renders exactly what this page rendered before the
 * tab existed: the YOUR REVIEW caption, the Status kicker, and the controls,
 * with no tab strip and no `tablist` in the accessibility tree at all (user
 * stories 20 and 21). Which Postings those are is `readCommute`'s to decide;
 * this component reads only whether it was handed a commute.
 *
 * Both panels stay mounted, the inactive one `hidden`. Notes are typed into
 * local state, and unmounting the review panel to look at the commute would
 * throw away an unsaved note — switching tabs is not a decision to discard
 * anything.
 */

const TABS = [
  { id: "review", label: "Your review" },
  { id: "commute", label: "Commute details" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type PostingPanelProps = {
  postingId: string;
  review: PostingReview;
  /** The commute, or null on a Posting that is not one — then, no tabs. */
  commute: Commute | null;
};

export function PostingPanel({
  postingId,
  review,
  commute,
}: PostingPanelProps) {
  const [active, setActive] = useState<TabId>("review");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  // Scoped rather than page-global: `review-panel` is a name anything else on
  // the page could also claim, and a duplicated id silently breaks the
  // `aria-controls` / `aria-labelledby` pairing rather than erroring.
  const panel = useId();

  // Canvas 4a: a "APPLIED · AUG 24" status line in `--accent-text`, shown once
  // the User has actually placed the Posting somewhere — "NEW" in the accent
  // tone would read as a decision that has not been made.
  const decided = review.status !== "new";
  const statusKicker = decided && (
    <MonoLabel tone="accent">
      {STATUS_LABELS[review.status]}
      {review.status === "applied" && review.appliedAt
        ? ` · ${formatDay(review.appliedAt)}`
        : ""}
    </MonoLabel>
  );

  if (!commute) {
    return (
      <Panel className="gap-[22px]">
        <ReviewControls
          postingId={postingId}
          review={review}
          heading={
            <div className="flex items-baseline justify-between gap-3">
              <MonoLabel as="p">Your review</MonoLabel>
              {statusKicker}
            </div>
          }
        />
      </Panel>
    );
  }

  /**
   * Arrow keys move between the tabs and select as they go — the panels are
   * already rendered, so there is nothing to load and no reason to make a User
   * press a second key to see what they moved to.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const from = TABS.findIndex((tab) => tab.id === active);
    const to =
      event.key === "ArrowRight"
        ? (from + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (from - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (to === null) return;

    event.preventDefault();
    setActive(TABS[to].id);
    tabs.current[to]?.focus();
  }

  return (
    <Panel className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Posting details"
          onKeyDown={onKeyDown}
          className="flex gap-0.5 rounded-control border border-border bg-field p-0.5"
        >
          {TABS.map((tab, index) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${panel}-${tab.id}-tab`}
                aria-selected={selected}
                aria-controls={`${panel}-${tab.id}-panel`}
                // One stop for the whole strip, as a tablist takes: Tab reaches
                // the selected tab, the arrows move within it.
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={`micro-label rounded-[5px] px-[11px] py-1.5 transition-colors ${
                  selected
                    ? "bg-accent-wash text-accent-text"
                    : "hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {/* The kicker belongs to the open tab but is laid out beside the tab
            strip (canvas 4a / 5a), so it sits outside the panel it describes.
            `aria-live` is what makes the swap audible: without it the radius
            verdict — the whole point of the commute tab — would change silently
            under a screen reader. */}
        <span aria-live="polite">
          {active === "review" ? statusKicker : <RadiusKicker commute={commute} />}
        </span>
      </div>

      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${panel}-${tab.id}-panel`}
          aria-labelledby={`${panel}-${tab.id}-tab`}
          hidden={tab.id !== active}
        >
          {tab.id === "review" ? (
            <ReviewControls postingId={postingId} review={review} />
          ) : (
            <CommuteDetails commute={commute} />
          )}
        </div>
      ))}
    </Panel>
  );
}

/**
 * Whether the Posting falls inside the radius the User stated (user story 19).
 *
 * Nothing at all when there is no verdict to give: a User who stated no radius
 * is not owed one, and neither is a journey whose distance is unknown.
 */
function RadiusKicker({ commute }: { commute: Commute }) {
  const verdict = radiusVerdict(commute);
  if (!verdict) return null;

  return (
    // Not `formatMiles`: the radius is a whole number of miles the User typed
    // (`@/criteria/schema` makes it an integer), so it reads back as they wrote
    // it. `formatMiles` is for a measured distance and would render a stated
    // radius of 5 as "5.0 mi".
    <MonoLabel tone={verdict === "within" ? "label" : "warn"}>
      {verdict === "within" ? "Within" : "Outside"} your {commute.radiusMiles} mi
      radius
    </MonoLabel>
  );
}

/** The card the panel sits on, the one thing both layouts share. */
function Panel({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col rounded-card border border-border bg-surface p-4 ${className}`}
    >
      {children}
    </section>
  );
}
