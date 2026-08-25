import { setupServer } from "msw/node";

/**
 * The HTTP boundary under test.
 *
 * Outbound HTTP is controlled here rather than by injecting a client, so code
 * under test calls `fetch` exactly as it does in production. Source adapters
 * (#5 onwards) declare their responses with `server.use(...)` inside the test
 * that needs them; handlers reset between tests.
 *
 * There are no default handlers on purpose: with `onUnhandledRequest: "error"`
 * any request a test did not declare fails loudly instead of reaching the
 * network.
 */
export const server = setupServer();
