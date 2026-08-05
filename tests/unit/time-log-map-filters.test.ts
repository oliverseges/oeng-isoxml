import { describe, expect, it } from "vitest";
import { buildExecutedMapExcludedMask } from "@/lib/isoxml/time-log-map-filters";
import type { SpatialBoundary } from "@/lib/isoxml/types";

const fieldBoundary: SpatialBoundary = {
  id: "PFD1",
  name: "Test field",
  sourceObjectUid: "PFD1#1",
  coordinates: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
};

describe("executed map filters", () => {
  it("combines zero, outlier and field masks", () => {
    const mask = buildExecutedMapExcludedMask(
      new Float64Array([0, 10, 20, 1_000, Number.NaN]),
      new Uint8Array([0, 0, 0, 1, 0]),
      new Float64Array([0.5, 0.5, 2, 0.5, 0.5]),
      new Float64Array([0.5, 0.5, 2, 0.5, 0.5]),
      {
        hideZeroValues: true,
        hideOutliers: true,
        clipToField: true,
        fieldBoundary,
      },
    );

    expect([...mask]).toEqual([1, 0, 1, 1, 0]);
  });

  it("does not clip when no field boundary can be resolved", () => {
    const mask = buildExecutedMapExcludedMask(
      new Float64Array([10]),
      new Uint8Array([0]),
      new Float64Array([2]),
      new Float64Array([2]),
      {
        hideZeroValues: false,
        hideOutliers: false,
        clipToField: true,
      },
    );

    expect([...mask]).toEqual([0]);
  });
});
