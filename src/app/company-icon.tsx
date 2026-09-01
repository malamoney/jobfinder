"use client";

import Image from "next/image";
import { useState } from "react";
import { companyIconSrc, companyMonogram } from "./format";
import type { Theme } from "./theme";

/** The rendered box, in CSS pixels — the one source of truth for the size. */
const SIZE = 36;

/** The disc both the monogram and the logo sit in, so the two never disagree. */
const DISC = "rounded-lg border border-border bg-field";

/**
 * The company mark in the corner of a Dashboard card (#62).
 *
 * The logo comes from Logo.dev's CDN, looked up by company name (ADR 0011) and
 * loaded straight from there — the Corpus stores nothing about it and no
 * nightly pass resolves it, because the CDN is already the cache. A custom
 * `next/image` loader points at Logo.dev directly rather than through Vercel's
 * image optimizer: the CDN already serves a small, cached, sized image, and
 * keeping the proxy out of it keeps that cost off the Vercel project (cf. #52,
 * #61).
 *
 * The monogram — the company's first initial on a neutral disc — is always
 * rendered as the base layer, and the logo sits on top of it. So the card
 * shows the monogram while the logo loads, if the name has no logo to find
 * (Logo.dev 404s, `strategy=match` + `fallback=404` in `companyIconSrc`, and
 * `onError` hides the image), or if there is no name or token at all. It never
 * waits on the lookup and never shows a bare broken image.
 *
 * `next/image` with a fixed width and height reserves the box before anything
 * loads, so a slow or failed logo never shifts the card's layout.
 *
 * `theme` comes from the server (the theme cookie, #79) so a monochrome mark is
 * asked for on the ground the `--field` disc actually has; a toggle flip
 * re-renders the card with the new value via `router.refresh()`.
 */
export function CompanyIcon({
  company,
  theme,
}: {
  company: string;
  theme: Theme;
}) {
  const [failed, setFailed] = useState(false);
  const src = companyIconSrc(company, SIZE, theme);

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${DISC}`}
      style={{ width: SIZE, height: SIZE }}
    >
      <span aria-hidden className="text-sm font-semibold text-label">
        {companyMonogram(company)}
      </span>

      {src && !failed && (
        <Image
          loader={({ width }) => companyIconSrc(company, width, theme) ?? src}
          src={company}
          alt=""
          width={SIZE}
          height={SIZE}
          onError={() => setFailed(true)}
          className={`absolute inset-0 ${DISC} object-contain`}
        />
      )}
    </span>
  );
}
