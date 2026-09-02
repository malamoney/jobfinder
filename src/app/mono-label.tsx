/**
 * A form's structural label in the Nocturne mono micro-caption style (#77):
 * the `micro-label` utility from `globals.css` (9.5px JetBrains Mono, uppercase,
 * `.14em` tracking) with the one thing form labels need that the standalone
 * captions do not — an `--accent-text` tone for the focused or active state the
 * mockups show (canvas 4a / 4c / 4e).
 *
 * The size and tracking still come from `micro-label`, so this cannot drift
 * from the Dashboard footer / empty state / loading note that wear the bare
 * utility. Pass `tone="accent"` for a statically-accent label (the Criteria
 * commute caption); for one that turns accent only while its field has focus,
 * leave the tone and add `group-focus-within:text-accent-text` in `className`.
 */
export function MonoLabel({
  children,
  tone = "label",
  as = "span",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "label" | "accent";
  as?: "span" | "legend" | "p";
  className?: string;
}) {
  const Component = as;
  return (
    <Component
      className={`micro-label ${tone === "accent" ? "text-accent-text" : ""} ${className}`}
    >
      {children}
    </Component>
  );
}
