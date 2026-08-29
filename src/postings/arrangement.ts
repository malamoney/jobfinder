import { ARRANGEMENTS, type Arrangement } from "@/criteria/schema";

/**
 * Arrangement Extraction: reading how the work is performed out of a Posting's
 * free text (#11) — the Arrangement half of what CONTEXT.md calls Extraction,
 * as `extractSalary` is the salary half.
 *
 * A pure function, tested directly (`arrangement.test.ts`). It runs in the
 * matching funnel over the Postings that survived title and keyword matching,
 * against the title, the location string, and the description together — a
 * Source almost never states the Arrangement structurally, and the location
 * ("Remote - US", "Hybrid - London") is where it most often hides.
 *
 * Two independent axes are being read: employment type (full-time, part-time)
 * and location mode (remote, onsite, hybrid). A Posting can state one, both, or
 * neither, and the filter in `matching` treats a silent axis as "unknown, so
 * do not exclude on it".
 *
 * Negation is handled only for "remote", because that is the one a job
 * description routinely denies in passing ("this role is not remote"). Beyond
 * that, contradictions are not resolved: a description that says both "remote"
 * and "onsite" is reported as saying both.
 */

/** A phrase that names an Arrangement, keyed by the Arrangement it names. */
const SIGNALS: Record<Arrangement, RegExp> = {
  "full-time": /\bfull[-\s]?time\b/i,
  "part-time": /\bpart[-\s]?time\b/i,
  remote:
    /\b(remote|remotely|telecommut\w*|work from home|work-from-home|wfh|fully distributed|distributed team)\b/i,
  // "in office" on its own is left out: a hybrid Posting says it too, and
  // tagging every hybrid role onsite would exclude it from a User who accepts
  // onsite but not hybrid. A genuinely onsite role says "onsite" or "in person".
  onsite: /\b(on-?site|in[-\s]person|on-?premises?)\b/i,
  hybrid: /\bhybrid\b/i,
};

/**
 * "Remote" appears in these shapes when a Posting is ruling it out, not
 * offering it. Matched before the positive signal is trusted.
 */
const REMOTE_DENIED_RE = new RegExp(
  [
    String.raw`\b(?:not|no|non-?|without|never|isn't|aren't)\s+(?:fully\s+|a\s+|currently\s+|be\s+)?remote\b`,
    String.raw`\bno\s+remote\s+work\b`,
    String.raw`\bremote\s+(?:work\s+)?(?:is|are)\s+not\b`,
    String.raw`\b(?:not?\s+(?:available|offered|possible)\s+(?:for\s+)?remote)\b`,
  ].join("|"),
  "i",
);

/**
 * The Arrangements a Posting's text states, in `ARRANGEMENTS` order.
 *
 * Empty when the text names none — which the funnel reads as "unknown", never
 * as "no Arrangement fits".
 */
export function extractArrangements(text: string): Arrangement[] {
  if (!text) return [];

  return ARRANGEMENTS.filter((arrangement) => {
    if (!SIGNALS[arrangement].test(text)) return false;
    if (arrangement === "remote" && REMOTE_DENIED_RE.test(text)) return false;
    return true;
  });
}
