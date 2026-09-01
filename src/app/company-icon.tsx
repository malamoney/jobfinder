"use client";

import Image from "next/image";
import { useState } from "react";
import { companyLogoSrc, companyMonogram } from "./format";

/**
 * The company mark in the corner of a Dashboard card (#62).
 *
 * The logo comes from Logo.dev's CDN, looked up by company name (ADR 0011) and
 * loaded straight from there — the Corpus stores nothing about it and no
 * nightly pass resolves it, because the CDN is already the cache. A company
 * Logo.dev cannot place (it answers 404, `fallback=404` in `companyLogoSrc`),
 * or a name too blank to look up, falls back to a monogram on a neutral disc,
 * so the card never shows a broken image and never waits on the lookup.
 *
 * `next/image` with a fixed width and height reserves the box before anything
 * loads, so a slow or failed logo never shifts the card's layout. A custom
 * `loader` points it at Logo.dev directly rather than through Vercel's image
 * optimizer — the CDN already serves a small, cached, sized image, and keeping
 * the proxy out of it keeps that cost off the Vercel project (cf. #52, #61).
 */

/** The rendered box, in CSS pixels. `size-9` on the element must match. */
const SIZE = 36;

const DISC =
  "size-9 shrink-0 rounded-lg border border-gray-200 bg-gray-100 object-contain";

/** Builds the Logo.dev URL for `next/image`; `src` is the company name. */
function logoLoader({ src, width }: { src: string; width: number }): string {
  // `companyLogoSrc` only returns null for a blank name or missing token, and
  // `CompanyIcon` has already shown the monogram in both cases before it gets
  // here — so the fallback to `src` is unreachable and just keeps the types honest.
  return companyLogoSrc(src, width) ?? src;
}

export function CompanyIcon({ company }: { company: string }) {
  const [failed, setFailed] = useState(false);

  if (failed || !companyLogoSrc(company, SIZE)) {
    return (
      <span
        aria-hidden
        className={`${DISC} flex items-center justify-center text-sm font-semibold text-gray-500`}
      >
        {companyMonogram(company)}
      </span>
    );
  }

  return (
    <Image
      loader={logoLoader}
      src={company}
      alt=""
      width={SIZE}
      height={SIZE}
      onError={() => setFailed(true)}
      className={DISC}
    />
  );
}
