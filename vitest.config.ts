import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./src/test/config.ts";

loadTestEnv();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // `scripts/` is covered too: discovery (#18) is deliberately not part of
    // the application, but reading a Slug out of a crawled URL is a decision
    // worth pinning wherever it lives.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.ts",
    ],
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Test files share one database and each one truncates it, so running them
    // concurrently would let a file wipe another file's rows mid-test.
    fileParallelism: false,
  },
});
