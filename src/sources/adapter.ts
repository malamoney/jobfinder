import { z } from "zod";

/**
 * How a Source is asked, and what makes an answer usable.
 *
 * Five Sources (#5, #14) answer in five shapes, but they answer the same
 * questions, and the rules for reading them are the ingestion spine's rather
 * than any one Source's: ask over HTTP under the caller's ceiling, refuse a
 * response that is not the document it claims to be, strip fields nobody asked
 * for, and fail loudly when a field the adapter depends on is gone (ADR 0003,
 * #7). Those rules live here so a sixth adapter inherits them instead of
 * remembering them.
 *
 * This module is the *asking*. Turning what came back into a Posting's fields
 * is `./fields`, which has no idea a network exists.
 */

/** One Source's document, as this adapter needs it to be. */
type BoardRequest<T> = {
  /** The Source's name as an error message should say it — `Greenhouse`. */
  label: string;
  /** The Board being read, named so a failure is traceable to one company. */
  slug: string;
  url: string;
  schema: z.ZodType<T>;
  /**
   * The ceiling on how long this may take. It belongs to the caller rather
   * than to any adapter: the Worker is the one whose budget is being spent,
   * and only it knows how much of that is left (#25).
   */
  signal: AbortSignal;
};

/**
 * Fetches one Board's document and validates it.
 *
 * Every failure is phrased against the Board, because that is what the Fetch
 * Task records and what #17 lists when a Board has to be found and disabled. A
 * raw `SyntaxError` from a Source serving an HTML error page under a 200 names
 * nothing at all.
 *
 * Unknown fields are stripped rather than rejected — Zod objects drop them by
 * default — because Sources add fields without notice and rejecting a response
 * would take a whole Board down over a field nobody wanted. A field the
 * adapter *depends on* going missing is the opposite case: the Board is broken,
 * not empty, and the Fetch must fail rather than report that the Board returned
 * no Postings, which ADR 0004 would read as every Posting on it having expired.
 */
export async function readBoardDocument<T>({
  label,
  slug,
  url,
  schema,
  signal,
}: BoardRequest<T>): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `${label} Board "${slug}" returned ${response.status} ${response.statusText}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `${label} Board "${slug}" answered with a body that is not JSON`,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `${label} Board "${slug}" returned a response this adapter does not understand: ${explainIssues(
        parsed.error,
      )}`,
    );
  }
  return parsed.data;
}

/** Names the fields that were wrong, so a broken Board is diagnosable. */
function explainIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * A Slug that is safe to address a Board by subdomain.
 *
 * Recruitee puts the Slug in the hostname rather than the path, and
 * `encodeURIComponent` does not contain it there: a Slug carrying a `/` or a
 * `.` would point the request at a different server entirely. Discovery probes
 * Slugs harvested from the open web (#18), so this is not a hypothetical input.
 * A DNS label is letters, digits, and hyphens, and anything else is refused
 * before a request is made.
 */
export function boardSubdomain(source: string, slug: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(slug)) {
    throw new Error(
      `${source} Board "${slug}" is not a Slug this Source can address`,
    );
  }
  return slug.toLowerCase();
}
