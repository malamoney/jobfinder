import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { applyVerdict, judgeDatabaseUrl } from "./src/db/remote-database";

config({ path: ".env.local", quiet: true });

// `pnpm db:migrate` does not go through `getDb()`, so the guardrail against a
// database that is not on this machine (#156) is applied here too, with the
// same consequences. drizzle-kit leaves NODE_ENV unset, so a remote host is
// normally a warning; the `migrate production` CI job opts out explicitly
// rather than print the production hostname. A missing URL is left for
// drizzle-kit to complain about.
if (process.env.DATABASE_URL) {
  applyVerdict(judgeDatabaseUrl(process.env.DATABASE_URL, process.env));
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
