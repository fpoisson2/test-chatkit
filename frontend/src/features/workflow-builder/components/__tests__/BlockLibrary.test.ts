import { describe, expect, it } from "vitest";

import { calculateBlockLibraryTransform } from "../BlockLibrary";

describe("calculateBlockLibraryTransform", () => {
  it("returns maximum emphasis for centered items", () => {
    const result = calculateBlockLibraryTransform(0, 200);

    expect(result.scale).toBeCloseTo(1.2, 3);
    expect(result.arcOffset).toBeCloseTo(0, 5);
    expect(result.opacity).toBeCloseTo(1, 3);
    expect(result.zIndex).toBe(200);
  });

  it("applies minimum emphasis at the edges of the viewport", () => {
    const result = calculateBlockLibraryTransform(200, 200);

    expect(result.scale).toBeCloseTo(0.82, 3);
    expect(result.arcOffset).toBeCloseTo(32, 3);
    expect(result.opacity).toBeCloseTo(0.55, 3);
    expect(result.zIndex).toBe(100);
  });

  it("smoothly eases styles for intermediate distances", () => {
    const result = calculateBlockLibraryTransform(75, 150);

    expect(result.scale).toBeCloseTo(1.0746, 3);
    expect(result.arcOffset).toBeCloseTo(11.314, 3);
    expect(result.opacity).toBeCloseTo(0.8516, 3);
    expect(result.zIndex).toBe(167);
  });
});
