import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  parseTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeCookie,
} from "./theme";

/**
 * The LIGHT / DARK choice lives in one cookie (#79). The server reads it on the
 * first paint and the toggle island writes it; both go through the helpers
 * here, so a crafted value can never put the app into a palette that is not one
 * of the two.
 */
describe("reading the theme cookie", () => {
  it("keeps a value that names one of the two palettes", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });

  it("falls back to the default when the cookie is absent", () => {
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme("")).toBe(DEFAULT_THEME);
  });

  it("falls back to the default for anything that is not a palette name", () => {
    expect(parseTheme("LIGHT")).toBe(DEFAULT_THEME);
    expect(parseTheme("sepia")).toBe(DEFAULT_THEME);
    expect(parseTheme("dark; evil")).toBe(DEFAULT_THEME);
  });

  it("defaults a brand-new visitor to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
  });
});

describe("the cookie the toggle writes", () => {
  it("persists the choice under the name the server reads, rooted at the site", () => {
    const cookie = themeCookie("light");
    expect(cookie).toContain(`${THEME_COOKIE}=light`);
    expect(cookie).toContain("path=/");
  });

  it("outlasts a session — a year, SameSite=Lax, no HttpOnly", () => {
    const cookie = themeCookie("dark");
    expect(cookie).toContain(`max-age=${THEME_COOKIE_MAX_AGE}`);
    expect(THEME_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie.toLowerCase()).not.toContain("httponly");
  });
});
