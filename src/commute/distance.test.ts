import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_MILES, formatMiles, greatCircleMiles } from "./distance";

/**
 * The straight-line distance the commute tab quotes (#101), and how it is
 * written.
 *
 * A pure normalizer, so it is tested directly rather than through the
 * operations seam — the same allowance `normalizeLocation` and `annualise`
 * take.
 *
 * The two exact cases are what pin the maths: a degree of longitude on the
 * equator is `R · π/180`, and the equator to a pole is a quarter of the great
 * circle. Both are answerable without a second implementation to check against.
 */

const JAMAICA_PLAIN = { latitude: 42.3097, longitude: -71.1151 };
const SEAPORT = { latitude: 42.3519, longitude: -71.0448 };
const BOSTON = { latitude: 42.3601, longitude: -71.0589 };
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

describe("the distance between two points", () => {
  it("is zero between a point and itself", () => {
    expect(greatCircleMiles(BOSTON, BOSTON)).toBe(0);
  });

  it("is a degree of the great circle across a degree of the equator", () => {
    const degree = (EARTH_RADIUS_MILES * Math.PI) / 180;

    expect(
      greatCircleMiles(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeCloseTo(degree, 6);
  });

  it("is a quarter of the great circle from the equator to a pole", () => {
    expect(
      greatCircleMiles(
        { latitude: 0, longitude: 0 },
        { latitude: 90, longitude: 0 },
      ),
    ).toBeCloseTo((EARTH_RADIUS_MILES * Math.PI) / 2, 6);
  });

  it("measures a city-sized journey", () => {
    expect(greatCircleMiles(JAMAICA_PLAIN, SEAPORT)).toBeCloseTo(4.63, 2);
  });

  it("measures a journey across the country", () => {
    expect(greatCircleMiles(BOSTON, AUSTIN)).toBeCloseTo(1693.96, 2);
  });

  it("reads the same in either direction", () => {
    expect(greatCircleMiles(BOSTON, AUSTIN)).toBeCloseTo(
      greatCircleMiles(AUSTIN, BOSTON),
      9,
    );
  });
});

describe("writing a distance", () => {
  it("keeps a tenth of a mile on a journey under ten miles", () => {
    expect(formatMiles(4.625531192881079)).toBe("4.6 mi");
    expect(formatMiles(0.24)).toBe("0.2 mi");
  });

  it("drops the decimal once a journey is ten miles or more", () => {
    expect(formatMiles(38.57617373046657)).toBe("39 mi");
    expect(formatMiles(1693.961602504246)).toBe("1,694 mi");
  });

  it("does not write a decimal that rounds up to ten", () => {
    expect(formatMiles(9.97)).toBe("10 mi");
  });
});
