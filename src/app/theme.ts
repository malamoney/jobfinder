/**
 * The LIGHT / DARK choice (#79).
 *
 * One name, two values — carried in a cookie so the server can set `data-theme`
 * on `<html>` before the first paint and there is no white flash. No column on
 * the User, no Server Action, no cross-device sync: the cookie is the whole
 * contract (decision recorded on #77). This module has nothing behind it, so
 * both the server (`layout.tsx`, `AppNav`) and the toggle island import it.
 */

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** What a visitor who has never touched the toggle gets. */
export const DEFAULT_THEME: Theme = "dark";

/** The cookie the server reads (`next/headers`) and the toggle island writes. */
export const THEME_COOKIE = "theme";

/**
 * A year. The theme is a standing preference, not a session thing — it should
 * outlast a fresh tab and every shorter-lived cookie the app sets.
 */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The Theme a cookie value names, or {@link DEFAULT_THEME} when the cookie is
 * absent or holds anything else. A crafted value can never land the app in a
 * state that is not one of the two palettes.
 */
export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
}

/**
 * The `document.cookie` string the toggle writes to persist a choice —
 * `SameSite=Lax`, long-lived, and readable by script (not `HttpOnly`) so the
 * island can also set it without a round trip.
 */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Apply a theme in the browser in one go: flip `<html>`'s `data-theme` so the
 * palette repaints at once, and write the cookie so the choice survives a
 * reload and a fresh tab. The toggle island calls this from its click handler —
 * a plain function, kept out of the component so the DOM writes are not read as
 * mutating render state.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookie(theme);
}
