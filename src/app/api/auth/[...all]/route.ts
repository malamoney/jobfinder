import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";

/**
 * better-auth's own endpoints.
 *
 * The forms in this application go through server actions rather than fetching
 * these, but the library expects to be mounted: its client, and every flow
 * added later that is not a form post — session refresh, a verification link,
 * an OAuth callback — addresses this path. Mounted through a function so the
 * handle stays lazy, or importing this route would build one at module scope
 * and `next build` has no database.
 */
export const { GET, POST } = toNextJsHandler((request: Request) =>
  getAuth().handler(request),
);
