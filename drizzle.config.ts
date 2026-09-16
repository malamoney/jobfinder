import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { judgeDatabaseUrl } from "./src/db/remote-database";

config({ path: ".env.local", quiet: true });

// `pnpm db:migrate` does not go through `getDb()`, so the guardrail against a
// database that is not on this machine (#156) is applied here too. drizzle-kit
// leaves NODE_ENV unset, so a remote host is a warning, never a refusal — the
// `migrate production` CI job opts out explicitly rather than rely on that.
const verdict = judgeDatabaseUrl(process.env.DATABASE_URL ?? "", process.env);
if (verdict.outcome !== "proceed") {
  console.warn(verdict.message);
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
