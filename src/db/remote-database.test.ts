import { describe, expect, it } from "vitest";
import {
  databaseHost,
  isLocalDatabase,
  judgeDatabaseUrl,
} from "./remote-database";

/**
 * A process that is not a production build has no business opening a database
 * that is not on this machine (#156). `.env.local` is gitignored, so when its
 * `DATABASE_URL` drifted to the production endpoint nothing said so, and a
 * week of `next dev` hot reloads exhausted the monthly transfer allowance
 * (#140). These pin what counts as "on this machine" and what each kind of
 * process does about a URL that is not.
 */

const NEON =
  "postgres://neondb_owner:hunter2secret@ep-broad-wildflower-a5nzwqg2-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("what counts as a local database", () => {
  it.each([
    ["postgres://localhost:5432/jobfinder", true],
    ["postgres://127.0.0.1:5432/jobfinder", true],
    ["postgres://127.0.0.2/jobfinder", true],
    ["postgres://[::1]:5432/jobfinder", true],
    ["postgres://[::ffff:127.0.0.1]/jobfinder", true],
    ["postgres://mike:pw@localhost/jobfinder", true],
    ["postgresql://LOCALHOST/jobfinder", true],
    // A Unix socket: node-postgres reads the directory from a percent-encoded
    // host, from a `host` query parameter, or defaults to it when no host is
    // given at all.
    ["postgres://%2Fvar%2Frun%2Fpostgresql/jobfinder", true],
    ["postgres:///jobfinder?host=/tmp", true],
    ["postgres:///jobfinder", true],
    [NEON, false],
    ["postgres://db.example.com/jobfinder", false],
    ["postgres://10.0.0.5/jobfinder", false],
    // Something that only sounds local.
    ["postgres://localhost.example.com/jobfinder", false],
  ])("%s → local: %s", (url, local) => {
    expect(isLocalDatabase(url)).toBe(local);
  });

  it("names the host without the credentials", () => {
    const host = databaseHost(NEON);
    expect(host).toBe(
      "ep-broad-wildflower-a5nzwqg2-pooler.us-east-2.aws.neon.tech",
    );
    expect(host).not.toContain("neondb_owner");
    expect(host).not.toContain("hunter2secret");
  });

  it("treats an unparseable URL as remote, naming it only as unparseable", () => {
    expect(isLocalDatabase("not a url at all")).toBe(false);
    expect(databaseHost("not a url at all")).toBe("(unparseable URL)");
  });
});

describe("what a process does about a remote database", () => {
  it("refuses in next dev, naming the host, the reason, and the override", () => {
    const verdict = judgeDatabaseUrl(NEON, { NODE_ENV: "development" });
    expect(verdict.outcome).toBe("refuse");
    if (verdict.outcome !== "refuse") return;
    expect(verdict.message).toContain(
      "ep-broad-wildflower-a5nzwqg2-pooler.us-east-2.aws.neon.tech",
    );
    expect(verdict.message).toContain("#140");
    expect(verdict.message).toContain("ALLOW_REMOTE_DATABASE=1");
    expect(verdict.message).not.toContain("hunter2secret");
    expect(verdict.message).not.toContain("neondb_owner");
  });

  it("warns and proceeds in a script, naming the host and the override", () => {
    const verdict = judgeDatabaseUrl(NEON, {});
    expect(verdict.outcome).toBe("warn");
    if (verdict.outcome !== "warn") return;
    expect(verdict.message).toContain(
      "ep-broad-wildflower-a5nzwqg2-pooler.us-east-2.aws.neon.tech",
    );
    expect(verdict.message).toContain("ALLOW_REMOTE_DATABASE=1");
    expect(verdict.message).not.toContain("hunter2secret");
  });

  it("is silent in a production build and in the test environment", () => {
    expect(judgeDatabaseUrl(NEON, { NODE_ENV: "production" })).toEqual({
      outcome: "proceed",
    });
    expect(judgeDatabaseUrl(NEON, { NODE_ENV: "test" })).toEqual({
      outcome: "proceed",
    });
  });

  it("is silent about a local database in every environment", () => {
    for (const NODE_ENV of ["development", "test", "production", undefined]) {
      expect(
        judgeDatabaseUrl("postgres://localhost:5432/jobfinder", { NODE_ENV }),
      ).toEqual({ outcome: "proceed" });
    }
  });

  it("ALLOW_REMOTE_DATABASE=1 opts a process out of both", () => {
    expect(
      judgeDatabaseUrl(NEON, {
        NODE_ENV: "development",
        ALLOW_REMOTE_DATABASE: "1",
      }),
    ).toEqual({ outcome: "proceed" });
    expect(judgeDatabaseUrl(NEON, { ALLOW_REMOTE_DATABASE: "1" })).toEqual({
      outcome: "proceed",
    });
  });

  it("does not read a blank or explicitly-off override as consent", () => {
    for (const ALLOW_REMOTE_DATABASE of ["", "0", "false"]) {
      expect(
        judgeDatabaseUrl(NEON, {
          NODE_ENV: "development",
          ALLOW_REMOTE_DATABASE,
        }).outcome,
      ).toBe("refuse");
    }
  });
});
