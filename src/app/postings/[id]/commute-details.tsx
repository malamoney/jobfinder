import Link from "next/link";
// The schema half of `@/commute`, with nothing behind it: pure types and pure
// arithmetic, so it runs here as readily as it does on the server.
import { formatMiles } from "@/commute/distance";
import { directionsUrl, MAPPING_SERVICE } from "@/commute/mapping";
import type { CommuteDetails as Commute, CommuteHome } from "@/commute/schema";
import type { LocationPrecision } from "@/geocoding/precision";
import { MonoLabel } from "../../mono-label";

/**
 * The COMMUTE DETAILS tab (#101, canvas 5a / 5b).
 *
 * Where the User lives, where the role is, how far apart they are, and a way
 * into the journey on a real map. The home is read-only here — a Posting page
 * is no place to change the origin of every distance in the product by
 * mistyping into what looked like a scratch field (user story 12) — so the way
 * to change it is a link through to Criteria (user story 13).
 *
 * What is deliberately absent: drive times. This slice has no routing provider
 * (#102), and the whole feature's rule is that a missing time is shown as
 * nothing rather than estimated from the distance. A straight line is a fact;
 * a straight line multiplied by a guess is a fabricated number.
 */

/** How much a distance measured from this home is worth trusting. */
const PRECISION_NOTE: Record<LocationPrecision, string> = {
  exact: "Measured from the address you gave.",
  city: "Measured from your city rather than your street, so this is approximate.",
  area: "Measured from a wide area, so this is a rough figure at best.",
};

/**
 * What stands in for the distance when there is no home to measure from, and
 * what the footer then offers to do about it.
 *
 * Held together in one place keyed by the state, so the sentence and the verb
 * that answers it cannot drift apart.
 */
const NO_DISTANCE: Record<
  Exclude<CommuteHome["state"], "placed">,
  { advice: string; action: string }
> = {
  none: {
    advice:
      "Jobfinder does not know where you live, so it cannot measure this journey. Add your home address in Criteria and the distance will appear here.",
    action: "Set home in",
  },
  unplaced: {
    advice:
      "That address could not be placed on a map, so there is no distance to measure. Check it in Criteria.",
    action: "Change home in",
  },
};

export function CommuteDetails({ commute }: { commute: Commute }) {
  // Every `home.state === "placed"` below is a narrowing guard, not a repeated
  // decision: it is what gives TypeScript the coordinate and the distance, and
  // what makes an unplaced home unable to reach the code that needs them.
  const { home, destination } = commute;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-3">
        <Place
          end="home"
          label="Home · from your criteria"
          value={home.state === "none" ? "Not set" : home.stated}
        />
        {/* Decorative: the two captions already say which end is which. */}
        <span
          aria-hidden="true"
          className="hidden self-end pb-2.5 text-[13px] text-disabled sm:block"
        >
          →
        </span>
        <Place
          end="posting"
          label="Posting location"
          value={destination.stated ?? "Not given"}
        />
      </div>

      {home.state === "placed" ? (
        <div className="flex flex-col gap-[7px] rounded-card border border-border bg-field p-3.5">
          <MonoLabel>Straight-line distance</MonoLabel>
          <span className="font-mono text-[25px] font-medium leading-none text-text">
            {formatMiles(home.distanceMiles)}
          </span>
          <p className="text-[12.5px] leading-relaxed text-label">
            {PRECISION_NOTE[home.at.precision]} A driving route is always
            longer.
          </p>
        </div>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-text-body">
          {NO_DISTANCE[home.state].advice}
        </p>
      )}

      <div
        className={`flex flex-wrap items-center gap-3 ${
          home.state === "placed" ? "justify-between" : "justify-end"
        }`}
      >
        {home.state === "placed" && (
          <a
            href={directionsUrl(home.at, destination.at)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] text-accent-text"
          >
            Open in {MAPPING_SERVICE} ↗
          </a>
        )}
        <span className="text-[12.5px] text-label">
          {home.state === "placed"
            ? "Change home in"
            : NO_DISTANCE[home.state].action}{" "}
          <Link href="/criteria" className="text-accent-text underline">
            Criteria
          </Link>
        </span>
      </div>
    </div>
  );
}

/**
 * The dot on each end of the journey (canvas 5a): the accent for where the User
 * starts, the warn gold for where the role is.
 *
 * The gold is the canvas's colour for a destination pin, not a warning about
 * anything — it is the one token in the palette that reads as a second pin
 * against the accent without inventing a colour outside it.
 */
const END_DOT = {
  home: "bg-accent",
  posting: "bg-warn",
} as const;

/**
 * One end of the journey: a mono caption over a read-only field (canvas 5a).
 *
 * It looks like the Criteria form's input and is not one — no `input`, no
 * `contentEditable`, nothing to type into — so there is no way to change a home
 * location from this page even by accident. The home says so out loud as well,
 * because a field that looks editable and silently is not is worse than one
 * that admits it.
 */
function Place({
  end,
  label,
  value,
}: {
  end: keyof typeof END_DOT;
  label: string;
  value: string;
}) {
  const home = end === "home";

  return (
    <div className="flex min-w-[13rem] flex-1 flex-col gap-[5px]">
      <MonoLabel>{label}</MonoLabel>
      <div
        className={`flex flex-1 items-center justify-between gap-2 rounded-control border border-border bg-field px-3 py-[9px] text-[13.5px] ${
          // The home reads a step back: it is context, not the thing being
          // looked at.
          home ? "text-label" : "text-text"
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-1.5 flex-none rounded-full ${END_DOT[end]}`}
          />
          {value}
        </span>
        {home && <span className="text-[11px] text-disabled">locked</span>}
      </div>
    </div>
  );
}
