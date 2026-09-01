import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";

/**
 * A Recruitee Board response, shaped like the real one.
 *
 * Fields and their spellings were taken from a live call to `recruitee.com` on
 * 2026-08-29, including the two quirks that matter: a Board is addressed by
 * *subdomain* rather than by path, and an offer's requirements are a document
 * of their own rather than part of the description.
 *
 * The endpoint is written out here rather than imported from the adapter, so
 * an adapter calling anything but the endpoint the source research recorded
 * fails every test — MSW refuses a request no handler declared.
 */

/** The URL the Recruitee adapter is expected to call. */
export function recruiteeBoardUrl(slug: string): string {
  return `https://${slug}.recruitee.com/api/offers/`;
}

/** Declares what a Recruitee Board returns. */
export function recruiteeBoardHandler(
  slug: string,
  offers: Array<Record<string, unknown>>,
  envelopeExtras: Record<string, unknown> = {},
) {
  return http.get(recruiteeBoardUrl(slug), () =>
    HttpResponse.json({ offers, ...envelopeExtras }),
  );
}

/** Declares what a Recruitee Board returns for the next Fetch of it. */
export function recruiteeBoardReturns(
  slug: string,
  offers: Array<Record<string, unknown>>,
): void {
  server.use(recruiteeBoardHandler(slug, offers));
}

/** Declares that a Recruitee Board answers, but refuses to serve it. */
export function recruiteeBoardRefuses(slug: string, status = 404): void {
  server.use(
    http.get(recruiteeBoardUrl(slug), () =>
      HttpResponse.json({ error: "Not Found" }, { status }),
    ),
  );
}

/** One offer as Recruitee returns it. */
export function recruiteeOffer(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 2_721_461,
    title: "Staff Engineer, Infrastructure",
    slug: "staff-engineer-infrastructure",
    company_name: "Acme",
    description: "<p>Build the thing.</p>",
    requirements: "",
    careers_url: "https://jobs.acme.com/o/staff-engineer-infrastructure",
    careers_apply_url:
      "https://jobs.acme.com/o/staff-engineer-infrastructure/c/new",
    // "Remote - US" by default: the matching funnel reads Arrangements out of
    // the location (#11), so this still says "remote", and ingestion stores only
    // US-based roles (ADR 0010), so a location with no country cue would be
    // dropped before it reached the Corpus.
    location: "Remote - US",
    city: null,
    country: null,
    remote: true,
    hybrid: false,
    on_site: false,
    status: "published",
    published_at: "2026-08-25 11:59:25 UTC",
    created_at: "2026-08-25 10:39:44 UTC",
    salary: { min: null, max: null, period: null, currency: null },
    ...overrides,
  };
}
