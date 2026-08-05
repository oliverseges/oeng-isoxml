import type { DecodedTimeLog, TimeLogChannel } from "./types";

export interface TimeLogChannelMetrics {
  presentCount: number;
  nonZeroCount: number;
  positionedValueCount: number;
  distinctValueCount: 0 | 1 | 2;
  distinctPositionCount: 0 | 1 | 2;
  missingPresentation: boolean;
  allZero: boolean;
  constantValue: boolean;
  noValidPosition: boolean;
  singlePosition: boolean;
  sparse: boolean;
}

export interface ExecutedChannelQualityFilters {
  hideEmpty: boolean;
  hideMissingPresentation: boolean;
  hideAllZero: boolean;
  hideConstant: boolean;
  hideNoPosition: boolean;
  hideSinglePosition: boolean;
  hideSparse: boolean;
}

export const USEFUL_CHANNEL_FILTERS: ExecutedChannelQualityFilters = {
  hideEmpty: true,
  hideMissingPresentation: true,
  hideAllZero: true,
  hideConstant: false,
  hideNoPosition: true,
  hideSinglePosition: true,
  hideSparse: false,
};

export const SHOW_ALL_CHANNEL_FILTERS: ExecutedChannelQualityFilters = {
  hideEmpty: false,
  hideMissingPresentation: false,
  hideAllZero: false,
  hideConstant: false,
  hideNoPosition: false,
  hideSinglePosition: false,
  hideSparse: false,
};

export const SINGLE_LOCATION_DIAMETER_METERS = 5;

const METERS_PER_DEGREE_LATITUDE = 111_320;

function boundingBoxDiagonalMeters(
  south: number,
  west: number,
  north: number,
  east: number,
): number {
  const latitudeDistance = (north - south) * METERS_PER_DEGREE_LATITUDE;
  const meanLatitudeRadians = ((south + north) / 2) * (Math.PI / 180);
  const longitudeDistance =
    (east - west) * METERS_PER_DEGREE_LATITUDE * Math.cos(meanLatitudeRadians);
  return Math.hypot(latitudeDistance, longitudeDistance);
}

function numericValue(rawValue: number, channel: TimeLogChannel): number {
  const offset = Number(channel.presentation.offset);
  const scale = Number(channel.presentation.scale);
  if (Number.isFinite(offset) && Number.isFinite(scale) && scale !== 0) {
    return (rawValue + offset) * scale;
  }
  return rawValue;
}

export function summarizeTimeLogChannel(
  timeLog: DecodedTimeLog,
  channel: TimeLogChannel,
): TimeLogChannelMetrics {
  const missingPresentation = channel.presentation.confidence === "missing";
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const rawValues = timeLog.rawValues[channelIndex];
  const present = timeLog.valuePresent[channelIndex];
  if (!rawValues || !present) {
    return {
      presentCount: 0,
      nonZeroCount: 0,
      positionedValueCount: 0,
      distinctValueCount: 0,
      distinctPositionCount: 0,
      missingPresentation,
      allZero: false,
      constantValue: false,
      noValidPosition: true,
      singlePosition: false,
      sparse: true,
    };
  }

  let presentCount = 0;
  let nonZeroCount = 0;
  let positionedValueCount = 0;
  let firstValue: number | undefined;
  let distinctValueCount: 0 | 1 | 2 = 0;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < present.length; index += 1) {
    if (!present[index]) continue;
    presentCount += 1;
    const value = numericValue(rawValues[index], channel);
    if (value !== 0) nonZeroCount += 1;
    if (firstValue === undefined) {
      firstValue = value;
      distinctValueCount = 1;
    } else if (distinctValueCount === 1 && value !== firstValue) {
      distinctValueCount = 2;
    }

    if (!timeLog.validPositions[index]) continue;
    positionedValueCount += 1;
    const latitude = timeLog.latitudes[index];
    const longitude = timeLog.longitudes[index];
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }

  const singlePosition =
    positionedValueCount > 0 &&
    boundingBoxDiagonalMeters(south, west, north, east) <=
      SINGLE_LOCATION_DIAMETER_METERS;
  const distinctPositionCount: 0 | 1 | 2 =
    positionedValueCount === 0 ? 0 : singlePosition ? 1 : 2;

  return {
    presentCount,
    nonZeroCount,
    positionedValueCount,
    distinctValueCount,
    distinctPositionCount,
    missingPresentation,
    allZero: presentCount > 0 && nonZeroCount === 0,
    constantValue: presentCount > 1 && distinctValueCount === 1,
    noValidPosition: positionedValueCount === 0,
    singlePosition,
    sparse: presentCount < 3,
  };
}

export function passesExecutedChannelQualityFilters(
  metrics: TimeLogChannelMetrics,
  filters: ExecutedChannelQualityFilters,
): boolean {
  if (filters.hideEmpty && metrics.presentCount === 0) return false;
  if (filters.hideMissingPresentation && metrics.missingPresentation) {
    return false;
  }
  if (filters.hideAllZero && metrics.allZero) return false;
  if (filters.hideConstant && metrics.constantValue) return false;
  if (filters.hideNoPosition && metrics.noValidPosition) return false;
  if (filters.hideSinglePosition && metrics.singlePosition) return false;
  if (filters.hideSparse && metrics.sparse) return false;
  return true;
}

export function hasExecutedChannelQualityFilters(
  filters: ExecutedChannelQualityFilters,
): boolean {
  return Object.values(filters).some(Boolean);
}
