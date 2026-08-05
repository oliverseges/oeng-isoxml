import {
  classIndexForValue,
  type ValueClassification,
} from "@/lib/isoxml/value-classification";
import type { DecodedGrid } from "@/lib/isoxml/types";

const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798;
const WORLD_TILE_SIZE = 256;
const MAX_GRID_RASTER_DIMENSION = 8_192;

export interface MapGridRaster {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface TimeLogPointRenderStyle {
  radius: number;
  fillAlpha: number;
  borderAlpha: number;
  borderWidth: number;
}

export function timeLogPointRenderStyle(zoom: number): TimeLogPointRenderStyle {
  const borderVisibility = Math.max(0, Math.min(1, (zoom - 16) / 2));
  return {
    radius: Math.max(3, Math.min(6, zoom - 12)),
    fillAlpha: 0.96,
    borderAlpha: borderVisibility * 0.42,
    borderWidth: 0.65,
  };
}

function colorComponents(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [60, 69, 65];
}

export function buildMapGridRaster(
  grid: DecodedGrid,
  hiddenCellMask: Uint8Array,
  noDataCells: Uint8Array,
  numericValueByCell: Float64Array,
  classification: ValueClassification,
  classColors: readonly string[],
): MapGridRaster | undefined {
  if (
    grid.rows > MAX_GRID_RASTER_DIMENSION ||
    grid.columns > MAX_GRID_RASTER_DIMENSION
  ) {
    return undefined;
  }
  const pixels = new Uint8ClampedArray(grid.rows * grid.columns * 4);
  const rgbByClass = classColors.map(colorComponents);
  const noDataColor: [number, number, number] = [60, 69, 65];
  for (let index = 0; index < grid.decodedCellCount; index += 1) {
    if (hiddenCellMask[index]) continue;
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const imageRow =
      grid.originCorner === "southwest" ? grid.rows - row - 1 : row;
    const pixelOffset = (imageRow * grid.columns + column) * 4;
    const classIndex = classIndexForValue(
      numericValueByCell[index],
      classification,
    );
    const color = noDataCells[index]
      ? noDataColor
      : classIndex === undefined
        ? noDataColor
        : rgbByClass[classIndex];
    pixels[pixelOffset] = color[0];
    pixels[pixelOffset + 1] = color[1];
    pixels[pixelOffset + 2] = color[2];
    pixels[pixelOffset + 3] = 224;
  }
  return { width: grid.columns, height: grid.rows, pixels };
}

export function webMercatorWorldPixel(
  latitude: number,
  longitude: number,
): { x: number; y: number } {
  const limitedLatitude = Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const sine = Math.sin((limitedLatitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * WORLD_TILE_SIZE,
    y:
      (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) *
      WORLD_TILE_SIZE,
  };
}
