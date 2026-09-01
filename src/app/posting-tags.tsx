import type { Posting } from "@/db/schema";
import { employmentLabels, workplaceLabels } from "./format";

/**
 * The row of pills a card and its detail page both show, so the two read as the
 * same product (#63).
 *
 * Two axes of Arrangement first — where the work happens (`workplaceLabels`)
 * and the commitment (`employmentLabels`) — then the Jobfinder-only signals the
 * generic design has no place for: a listing the Board stopped returning (#7),
 * and a location no geocoder could place, which means the radius was never
 * applied to it (#12). Both are shown, never dropped.
 */
export function PostingTags({
  posting,
}: {
  posting: Pick<Posting, "arrangements"> & {
    expired?: boolean;
    unresolvedLocation?: boolean;
  };
}) {
  const labels = [...workplaceLabels(posting), ...employmentLabels(posting)];

  if (
    labels.length === 0 &&
    !posting.expired &&
    !posting.unresolvedLocation
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label) => (
        <Tag key={label}>{label}</Tag>
      ))}
      {posting.expired && <Tag tone="muted">Expired</Tag>}
      {posting.unresolvedLocation && (
        <Tag tone="warn">Location unresolved</Tag>
      )}
    </div>
  );
}

/** One pill. `warn` is the caution tone the un-geocoded location wears. */
function Tag({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "muted" | "warn";
}) {
  const tones = {
    default: "bg-tag text-text-body",
    muted: "bg-tag text-label",
    warn: "bg-warn/15 text-warn",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
