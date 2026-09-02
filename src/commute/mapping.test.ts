import { describe, expect, it } from "vitest";
import { directionsUrl } from "./mapping";

/**
 * The link out to a public mapping service (#101, user story 10).
 *
 * A pure normalizer, tested directly. What matters is that a User can open the
 * journey without an account and without retyping two addresses — so the URL
 * carries no key of ours, and it names the two ends by coordinate rather than
 * by the text a Source happened to write.
 */

const JAMAICA_PLAIN = { latitude: 42.3097, longitude: -71.1151 };
const SEAPORT = { latitude: 42.3519, longitude: -71.0448 };

describe("the link that opens the journey elsewhere", () => {
  it("names both ends by coordinate, as a driving journey", () => {
    expect(directionsUrl(JAMAICA_PLAIN, SEAPORT)).toBe(
      "https://www.google.com/maps/dir/?api=1" +
        "&origin=42.3097%2C-71.1151" +
        "&destination=42.3519%2C-71.0448" +
        "&travelmode=driving",
    );
  });

  it("carries nothing that has to be provisioned", () => {
    const url = directionsUrl(JAMAICA_PLAIN, SEAPORT);

    expect(url).not.toMatch(/key|token|apikey/i);
  });
});
