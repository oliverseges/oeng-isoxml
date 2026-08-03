import { describe, expect, it } from "vitest";
import { calculateDoseStatistics } from "../../lib/isoxml/dose-statistics";

describe("dose statistics", () => {
  it("calculates the average and integrates kg/ha over the cell area", () => {
    const statistics = calculateDoseStatistics([10, 20, 30], 100, "kg/ha");

    expect(statistics.average).toBe(20);
    expect(statistics.averageUnit).toBe("kg/ha");
    expect(statistics.total).toBeCloseTo(0.6);
    expect(statistics.totalUnit).toBe("kg");
  });

  it("integrates rates declared per square metre", () => {
    const statistics = calculateDoseStatistics([2, 3], 10, "mg/m²");

    expect(statistics.total).toBe(50);
    expect(statistics.totalUnit).toBe("mg");
  });

  it("keeps the average but omits a meaningless total for non-area units", () => {
    const statistics = calculateDoseStatistics([40, 60], 10, "%");

    expect(statistics.average).toBe(50);
    expect(statistics.total).toBeUndefined();
  });

  it("ignores non-finite values and returns no statistics for an empty layer", () => {
    expect(
      calculateDoseStatistics([Number.NaN, Infinity], 10, "kg/ha"),
    ).toEqual({});
  });

  it("computes directly from typed values while excluding filtered cells", () => {
    const statistics = calculateDoseStatistics(
      Float64Array.of(10, 20, 1_000),
      100,
      "kg/ha",
      Uint8Array.of(0, 0, 1),
    );

    expect(statistics.average).toBe(15);
    expect(statistics.total).toBeCloseTo(0.3);
  });
});
