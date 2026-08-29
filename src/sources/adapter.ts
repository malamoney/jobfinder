import { z } from "zod";

/**
 * How a Source is asked, and what makes an answer usable.
 *
 * The Sources (#5, #14, #15) answer in as many shapes as there are of them, but
 * they answer the same questions, and the rules for reading them are the
 * ingestion spine's rather than any one Source's: ask over HTTP under the
 * caller's ceiling, refuse a response that is not the document it claims to be,
 * strip fields nobody asked for, and fail loudly when a field the adapter
 * depends on is gone (ADR 0003, #7). Those rules live here so the next adapter
 * inherits them instead of remembering them.
 *
 * `readBoardDocument` is the ATS case — one request, phrased against the Board.
 * `readSourceDocument` is the general one an aggregator's paged fetch calls per
 * page, with its own `subject` and, where a Source needs it, request headers.
 *
 * This module is the *asking*. Turning what came back into a Posting's fields
 * is `./fields`, which has no idea a network exists.
 */

/** One request to a Source, and what makes an answer usable. */
type SourceRequest<T> = {
  /** The Source's name as an error message should say it — `Greenhouse`. */
  label: string;
  /**
   * What was being asked for, so a failure is traceable — `Board "acme"` for an
   * ATS Source, `page 3` or a slice for an aggregator. Reads straight after the
   * label: `Greenhouse Board "acme" returned 404`.
   */
  subject: string;
  url: string;
  /**
   * Request headers, for the Sources that need them — USAJOBS wants an API key
   * and a contact address (#15). Omitted for the ATS Boards, which are
   * unauthenticated.
   */
  headers?: HeadersInit;
  schema: z.ZodType<T>;
  /**
   * The ceiling on how long this may take. It belongs to the caller rather
   * than to any adapter: the Worker is the one whose budget is being spent,
   * and only it knows how much of that is left (#25).
   */
  signal: AbortSignal;
};

/**
 * Fetches one document from a Source and validates it.
 *
 * Every failure is phrased against `subject`, because that is what the Fetch
 * Task records and what #17 lists when a Board has to be found and disabled. A
 * raw `SyntaxError` from a Source serving an HTML error page under a 200 names
 * nothing at all.
 *
 * Unknown fields are stripped rather than rejected — Zod objects drop them by
 * default — because Sources add fields without notice and rejecting a response
 * would take a whole Board down over a field nobody wanted. A field the
 * adapter *depends on* going missing is the opposite case: the Source is
 * broken, not empty, and the Fetch must fail rather than report that it
 * returned no Postings, which ADR 0004 would read as every Posting having
 * expired.
 */
export async function readSourceDocument<T>({
  label,
  subject,
  url,
  headers,
  schema,
  signal,
}: SourceRequest<T>): Promise<T> {
  const response = await fetch(url, { signal, headers });
  if (!response.ok) {
    throw new Error(
      `${label} ${subject} returned ${response.status} ${response.statusText}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} ${subject} answered with a body that is not JSON`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `${label} ${subject} returned a response this adapter does not understand: ${explainIssues(
        parsed.error,
      )}`,
    );
  }
  return parsed.data;
}

/**
 * Fetches one Board's document and validates it.
 *
 * The ATS case of `readSourceDocument`: the subject is always the Board, so a
 * failure names the one company whose Slug has to be fixed or disabled.
 */
export function readBoardDocument<T>({
  label,
  slug,
  url,
  schema,
  signal,
}: {
  label: string;
  slug: string;
  url: string;
  schema: z.ZodType<T>;
  signal: AbortSignal;
}): Promise<T> {
  return readSourceDocument({
    label,
    subject: `Board "${slug}"`,
    url,
    schema,
    signal,
  });
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
