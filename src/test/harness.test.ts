import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { listProbeNames, recordProbeFrom } from "./harness-operations";
import { server } from "./msw";

const PROBE_URL = "https://boards.example.test/probe";

/**
 * Proves the test harness works, and stands as the worked example later
 * tickets copy.
 *
 * The shape is the one #2 asks for and #5 inherits: call an operation at the
 * primary seam, let MSW supply what the Source returned, and assert on what
 * the application can observe afterwards — never on how it got there. Nothing
 * here reaches for the database directly or mocks a collaborator.
 */
describe("the test harness", () => {
  it("records what a Source returned", async () => {
    server.use(
      http.get(PROBE_URL, () => HttpResponse.json({ name: "acme" })),
    );

    await recordProbeFrom(PROBE_URL);

    expect(await listProbeNames()).toEqual(["acme"]);
  });

  it("leaves no rows behind for the next test", async () => {
    expect(await listProbeNames()).toEqual([]);
  });

  // Asserts the reason, not merely that it threw: an unreachable host would
  // reject too, which would make this pass whether MSW were installed or not.
  it("fails a request no test declared rather than reaching the network", async () => {
    await expect(recordProbeFrom(PROBE_URL)).rejects.toThrow(/\[MSW\]/);
  });
});
