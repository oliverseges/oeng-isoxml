import { describe, expect, it } from "vitest";
import { extremeOutlierBounds } from "@/lib/isoxml/outliers";

describe("extremeOutlierBounds", () => {
  it("does not classify nearby values as outliers when the IQR is flat", () => {
    const bounds = extremeOutlierBounds([
      95, 100, 100, 100, 100, 100, 100, 105, 400,
    ]);

    expect(bounds).toEqual({ lower: 50, upper: 150 });
    expect(95).toBeGreaterThanOrEqual(bounds!.lower);
    expect(105).toBeLessThanOrEqual(bounds!.upper);
    expect(400).toBeGreaterThan(bounds!.upper);
  });

  it("uses the far-out 3× IQR fence for varied data", () => {
    expect(extremeOutlierBounds([80, 90, 100, 110, 120])).toEqual({
      lower: 30,
      upper: 170,
    });
  });

  it("does not calculate a fence from fewer than four values", () => {
    expect(extremeOutlierBounds([1, 2, 100])).toBeUndefined();
  });
});
