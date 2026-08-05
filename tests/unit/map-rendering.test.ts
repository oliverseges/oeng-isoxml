import { describe, expect, it } from "vitest";
import {
  buildMapGridRaster,
  webMercatorWorldPixel,
} from "@/components/viewer/map-rendering";
import type { DecodedGrid } from "@/lib/isoxml/types";
import type { ValueClassification } from "@/lib/isoxml/value-classification";

const classification: ValueClassification = {
  min: 1,
  max: 4,
  classCount: 2,
  mode: "equal-interval",
  distinctValues: [],
};

describe("map rendering primitives", () => {
  it("projects geographic coordinates into Leaflet-compatible world pixels", () => {
    expect(webMercatorWorldPixel(0, 0)).toEqual({ x: 128, y: 128 });
    expect(webMercatorWorldPixel(0, 180).x).toBe(256);
    expect(webMercatorWorldPixel(85.0511287798, 0).y).toBeCloseTo(0, 7);
  });

  it("rasterizes southwest-origin grid rows in north-up image order", () => {
    const grid = {
      rows: 2,
      columns: 2,
      decodedCellCount: 4,
      originCorner: "southwest",
    } as DecodedGrid;
    const raster = buildMapGridRaster(
      grid,
      Uint8Array.from([0, 0, 0, 1]),
      new Uint8Array(4),
      Float64Array.from([1, 2, 3, 4]),
      classification,
      ["#112233", "rgb(68, 85, 102)"],
    );

    expect(raster).toBeDefined();
    expect(Array.from(raster!.pixels)).toEqual([
      68, 85, 102, 224, 0, 0, 0, 0, 17, 34, 51, 224, 17, 34, 51, 224,
    ]);
  });
});
