/**
 * The guardrail against developing on a database that is not on this machine
 * (#156).
 *
 * `.env.local` is gitignored and unreviewed, so when its `DATABASE_URL` drifted
 * to the pooled production endpoint nothing said so, and a week of `next dev`
 * hot reloads exhausted the project's monthly transfer allowance (#140). The
 * rule that catches it without hardcoding a hostname into the repo: a process
 * that is not a production build has no business talking to a database that is
 * not on this machine.
 *
 * Pure functions of the URL and the environment, so they are unit-tested
 * without a database. `getDb()` and `drizzle.config.ts` apply the verdict at
 * the moment they first open a connection.
 */

/** What a process does about the database it is about to open. */
export type DatabaseUrlVerdict =
  | { outcome: "proceed" }
  | { outcome: "warn"; message: string }
  | { outcome: "refuse"; message: string };

/** The slice of the environment the verdict depends on. */
export interface DatabaseUrlEnvironment {
  NODE_ENV?: string;
  ALLOW_REMOTE_DATABASE?: string;
}

/**
 * Decides what to do about `url` in this environment.
 *
 * - `next dev` sets `NODE_ENV=development`: a remote host is refused.
 * - `tsx` scripts (`warm-geocodes`, `seed:boards`) leave it unset: they run
 *   against production on purpose, so a remote host is a warning — a useful
 *   reminder of what they are about to touch — and the process proceeds.
 * - A production build and the test suite are silent.
 * - `ALLOW_REMOTE_DATABASE=1` opts any process out.
 */
export function judgeDatabaseUrl(
  url: string,
  env: DatabaseUrlEnvironment,
): DatabaseUrlVerdict {
  if (env.NODE_ENV === "production" || env.NODE_ENV === "test") {
    return { outcome: "proceed" };
  }
  if (isOptedOut(env.ALLOW_REMOTE_DATABASE)) {
    return { outcome: "proceed" };
  }
  if (isLocalDatabase(url)) {
    return { outcome: "proceed" };
  }

  const where = `DATABASE_URL points at ${databaseHost(url)}, which is not on this machine.`;
  if (env.NODE_ENV === "development") {
    return {
      outcome: "refuse",
      message:
        `Refusing to connect: ${where} ` +
        "Development traffic there is metered against the production allowance (#140). " +
        "Point .env.local at a local Postgres, or set ALLOW_REMOTE_DATABASE=1 if you mean it.",
    };
  }
  return {
    outcome: "warn",
    message: `${where} Set ALLOW_REMOTE_DATABASE=1 to silence this.`,
  };
}

function isOptedOut(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Carries a verdict out: a refusal throws, a warning is printed once — the
 * caller reaches this once per connection, not once per query — and
 * proceeding is silent.
 */
export function applyVerdict(verdict: DatabaseUrlVerdict): void {
  switch (verdict.outcome) {
    case "refuse":
      throw new Error(verdict.message);
    case "warn":
      console.warn(verdict.message);
      return;
    case "proceed":
      return;
  }
}

/**
 * Whether a connection string reaches a database on this machine: `localhost`,
 * a loopback address (IPv4 or IPv6), or a Unix socket. Anything else — and
 * anything that cannot be parsed — is remote.
 */
export function isLocalDatabase(url: string): boolean {
  const target = parseTarget(url);
  switch (target.kind) {
    case "socket":
      return true;
    case "host":
      return isLoopback(target.host);
    case "unparseable":
      return false;
  }
}

/**
 * The host a connection string names, for a message. Never the credentials —
 * the URL carries the password, and the message ends up in a terminal or a
 * log.
 */
export function databaseHost(url: string): string {
  const target = parseTarget(url);
  switch (target.kind) {
    case "socket":
      return `Unix socket ${target.path}`;
    case "host":
      return target.host;
    case "unparseable":
      return "(unparseable URL)";
  }
}

type ConnectionTarget =
  | { kind: "socket"; path: string }
  | { kind: "host"; host: string }
  | { kind: "unparseable" };

/**
 * Where node-postgres would connect. It reads a Unix socket directory from a
 * percent-encoded host (`postgres://%2Ftmp/db`), from a `host` query parameter
 * (`postgres:///db?host=/tmp`), or by default when no host is given at all.
 */
function parseTarget(url: string): ConnectionTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unparseable" };
  }

  const queryHost = parsed.searchParams.get("host");
  if (queryHost?.startsWith("/")) {
    return { kind: "socket", path: queryHost };
  }

  const host = decodeURIComponent(parsed.hostname).toLowerCase();
  if (host === "") {
    return { kind: "socket", path: "(default directory)" };
  }
  if (host.startsWith("/")) {
    return { kind: "socket", path: host };
  }
  return { kind: "host", host };
}

/**
 * `localhost` or a loopback address. The URL parser normalises IPv6 into its
 * compressed form, so a mapped IPv4 loopback arrives as `[::ffff:7f00:1]`.
 */
function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  const ipv6 = host.match(/^\[(.*)\]$/)?.[1];
  if (ipv6 === undefined) return false;
  if (ipv6 === "::1") return true;
  return /^::ffff:(7f00:[0-9a-f]{1,4}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(
    ipv6,
  );
}
