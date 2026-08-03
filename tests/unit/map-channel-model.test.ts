import { describe, expect, it } from "vitest";
import { buildMapChannelValues } from "@/lib/isoxml/map-channel-model";
import type { ValuePresentation } from "@/lib/isoxml/types";

const presentation: ValuePresentation = {
  id: "VPN1",
  offset: "0",
  scale: "0.1",
  decimals: 1,
  source: "VPN VPN1",
  confidence: "declared",
};

describe("map channel model", () => {
  it("keeps zero, no-data and wild outlier masks independent", () => {
    const model = buildMapChannelValues(
      new Int32Array([0, 100, 100, 100, 100, 100_000, -2_147_483_648]),
      7,
      presentation,
    );

    expect([...model.zeroCells]).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect([...model.noDataCells]).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(model.outlierCells[5]).toBe(1);
    expect(model.numericValueByCell[1]).toBe(10);
  });

  it("bounds its arrays by complete decoded records", () => {
    const model = buildMapChannelValues(
      new Int32Array([1, 2]),
      1_000_000,
      presentation,
    );

    expect(model.numericValueByCell).toHaveLength(2);
    expect(model.emptyCells).toHaveLength(2);
  });
});
