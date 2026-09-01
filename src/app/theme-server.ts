import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, type Theme } from "./theme";

/**
 * The visitor's theme, read from the cookie on the server.
 *
 * `layout.tsx` sets `data-theme` from this, `AppNav` hands it to the toggle,
 * and the Dashboard threads it to the company marks — one reader, so the three
 * cannot drift, and a fourth consumer is one call rather than a fourth copy of
 * the cookie lookup. Kept out of `theme.ts` because that module is also
 * imported by the client island, which must not pull in `next/headers`.
 */
export async function readTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
