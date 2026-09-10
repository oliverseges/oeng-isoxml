import type { DecodedGrid, SpatialBoundary } from "./types";

export interface GeographicCellBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export type GeographicGridBounds = [[number, number], [number, number]];

export interface GeographicViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GridCellRange {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

export function pointIsInsideBoundary(
  latitude: number,
  longitude: number,
  boundary: SpatialBoundary,
): boolean {
  let inside = false;
  const points = boundary.coordinates;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const [currentLatitude, currentLongitude] = points[index];
    const [previousLatitude, previousLongitude] = points[previous];
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const crossingLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < crossingLongitude) inside = !inside;
  }
  return inside;
}

export function geographicDistanceMeters(
  start: GeographicPoint,
  end: GeographicPoint,
): number {
  const earthRadiusMeters = 6_371_008.8;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitudeRadians = (start.latitude * Math.PI) / 180;
  const endLatitudeRadians = (end.latitude * Math.PI) / 180;
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const a =
    sinLatitude * sinLatitude +
    Math.cos(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      sinLongitude * sinLongitude;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function polylineDistanceMeters(points: GeographicPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += geographicDistanceMeters(points[index - 1], points[index]);
  }
  return total;
}

export function gridStepDegrees(grid: DecodedGrid): {
  latitude: number;
  longitude: number;
} {
  if (grid.cellSizeUnit === "degrees") {
    return {
      latitude: grid.cellSize.northSouth,
      longitude: grid.cellSize.eastWest,
    };
  }
  const metersPerDegree = 111_320;
  return {
    latitude: grid.cellSize.northSouth / metersPerDegree,
    longitude:
      grid.cellSize.eastWest /
      (metersPerDegree * Math.cos((grid.origin.latitude * Math.PI) / 180)),
  };
}

export function gridCellAreaSquareMeters(
  grid: DecodedGrid,
): number | undefined {
  const dimensions = gridCellDimensionsMeters(grid);
  if (!dimensions) return undefined;
  const area = dimensions.northSouth * dimensions.eastWest;
  return Number.isFinite(area) && area > 0 ? area : undefined;
}

export function gridCellDimensionsMeters(
  grid: DecodedGrid,
): { northSouth: number; eastWest: number } | undefined {
  if (
    !Number.isFinite(grid.cellSize.northSouth) ||
    !Number.isFinite(grid.cellSize.eastWest) ||
    grid.cellSize.northSouth <= 0 ||
    grid.cellSize.eastWest <= 0
  ) {
    return undefined;
  }

  if (grid.cellSizeUnit === "meters") {
    return {
      northSouth: grid.cellSize.northSouth,
      eastWest: grid.cellSize.eastWest,
    };
  }

  const metersPerDegree = 111_320;
  const northSouthMeters = grid.cellSize.northSouth * metersPerDegree;
  const eastWestMeters =
    grid.cellSize.eastWest *
    metersPerDegree *
    Math.cos((grid.origin.latitude * Math.PI) / 180);
  if (
    !Number.isFinite(northSouthMeters) ||
    !Number.isFinite(eastWestMeters) ||
    northSouthMeters <= 0 ||
    eastWestMeters <= 0
  ) {
    return undefined;
  }
  return { northSouth: northSouthMeters, eastWest: eastWestMeters };
}

export function isSpatialGridValid(grid: DecodedGrid): boolean {
  const step = gridStepDegrees(grid);
  return (
    grid.spatialStatus === "valid" &&
    Number.isFinite(grid.origin.latitude) &&
    Number.isFinite(grid.origin.longitude) &&
    Math.abs(grid.origin.latitude) <= 90 &&
    Math.abs(grid.origin.longitude) <= 180 &&
    Number.isFinite(step.latitude) &&
    Number.isFinite(step.longitude) &&
    step.latitude > 0 &&
    step.longitude > 0 &&
    Number.isInteger(grid.rows) &&
    Number.isInteger(grid.columns) &&
    grid.rows > 0 &&
    grid.columns > 0
  );
}

export function geographicGridBounds(
  grid: DecodedGrid,
): GeographicGridBounds | undefined {
  if (!isSpatialGridValid(grid)) return undefined;
  const step = gridStepDegrees(grid);
  const otherLatitude =
    grid.originCorner === "southwest"
      ? grid.origin.latitude + grid.rows * step.latitude
      : grid.origin.latitude - grid.rows * step.latitude;
  const south = Math.min(grid.origin.latitude, otherLatitude);
  const north = Math.max(grid.origin.latitude, otherLatitude);
  const east = grid.origin.longitude + grid.columns * step.longitude;
  if (![south, north, east].every(Number.isFinite)) return undefined;
  return [
    [south, grid.origin.longitude],
    [north, east],
  ];
}

export function geographicCellBounds(
  grid: DecodedGrid,
  row: number,
  column: number,
): GeographicCellBounds | undefined {
  if (!isSpatialGridValid(grid)) return undefined;
  const step = gridStepDegrees(grid);
  const west = grid.origin.longitude + column * step.longitude;
  const east = west + step.longitude;
  const firstLatitude =
    grid.originCorner === "southwest"
      ? grid.origin.latitude + row * step.latitude
      : grid.origin.latitude - row * step.latitude;
  const secondLatitude =
    grid.originCorner === "southwest"
      ? firstLatitude + step.latitude
      : firstLatitude - step.latitude;
  return {
    north: Math.max(firstLatitude, secondLatitude),
    south: Math.min(firstLatitude, secondLatitude),
    west,
    east,
  };
}

export function geographicCellCenter(
  grid: DecodedGrid,
  row: number,
  column: number,
): { latitude: number; longitude: number } | undefined {
  const bounds = geographicCellBounds(grid, row, column);
  if (!bounds) return undefined;
  return {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
  };
}

export function gridCellIndexAt(
  grid: DecodedGrid,
  latitude: number,
  longitude: number,
): number | undefined {
  if (!isSpatialGridValid(grid)) return undefined;
  const step = gridStepDegrees(grid);
  const column = Math.floor(
    (longitude - grid.origin.longitude) / step.longitude,
  );
  const row =
    grid.originCorner === "southwest"
      ? Math.floor((latitude - grid.origin.latitude) / step.latitude)
      : Math.floor((grid.origin.latitude - latitude) / step.latitude);
  if (row < 0 || row >= grid.rows || column < 0 || column >= grid.columns) {
    return undefined;
  }
  const index = row * grid.columns + column;
  return index < grid.decodedCellCount ? index : undefined;
}

export function gridCellRangeForBounds(
  grid: DecodedGrid,
  viewport: GeographicViewportBounds,
): GridCellRange | undefined {
  if (!isSpatialGridValid(grid)) return undefined;
  const step = gridStepDegrees(grid);
  const firstColumn = Math.max(
    0,
    Math.floor((viewport.west - grid.origin.longitude) / step.longitude) - 1,
  );
  const lastColumn = Math.min(
    grid.columns - 1,
    Math.ceil((viewport.east - grid.origin.longitude) / step.longitude - 1e-9),
  );
  const rowAtSouth =
    grid.originCorner === "southwest"
      ? (viewport.south - grid.origin.latitude) / step.latitude
      : (grid.origin.latitude - viewport.south) / step.latitude;
  const rowAtNorth =
    grid.originCorner === "southwest"
      ? (viewport.north - grid.origin.latitude) / step.latitude
      : (grid.origin.latitude - viewport.north) / step.latitude;
  const firstRow = Math.max(
    0,
    Math.floor(Math.min(rowAtSouth, rowAtNorth)) - 1,
  );
  const lastRow = Math.min(
    grid.rows - 1,
    Math.ceil(Math.max(rowAtSouth, rowAtNorth) - 1e-9),
  );
  if (firstRow > lastRow || firstColumn > lastColumn) return undefined;
  return { firstRow, lastRow, firstColumn, lastColumn };
}
