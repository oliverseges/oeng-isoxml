import { describe, expect, it } from "vitest";
import {
  passesExecutedChannelQualityFilters,
  SHOW_ALL_CHANNEL_FILTERS,
  SINGLE_LOCATION_DIAMETER_METERS,
  summarizeTimeLogChannel,
  USEFUL_CHANNEL_FILTERS,
} from "@/lib/isoxml/timelog-channel-quality";
import type { DecodedTimeLog, TimeLogChannel } from "@/lib/isoxml/types";

const channel: TimeLogChannel = {
  channelId: "channel-1",
  dlvIndex: 0,
  ddi: 6,
  ddiDisplay: "0006",
  ddiName: "Application rate",
  dictionarySource: "test",
  presentation: {
    id: "presentation-1",
    offset: "0",
    scale: "0.1",
    decimals: 1,
    source: "test",
    confidence: "declared",
  },
  label: "DDI 0006 · Application rate",
};

function timeLog(
  values: number[],
  positions: Array<[number, number] | undefined>,
): DecodedTimeLog {
  return {
    channels: [channel],
    rawValues: [Int32Array.from(values)],
    valuePresent: [Uint8Array.from(values.map(() => 1))],
    latitudes: Float64Array.from(
      positions.map((position) => position?.[0] ?? Number.NaN),
    ),
    longitudes: Float64Array.from(
      positions.map((position) => position?.[1] ?? Number.NaN),
    ),
    validPositions: Uint8Array.from(
      positions.map((position) => (position ? 1 : 0)),
    ),
  } as DecodedTimeLog;
}

describe("executed time-log channel quality", () => {
  it("detects all-zero channels even with a scaled presentation", () => {
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [0, 0, 0],
        [
          [55, 10],
          [55.1, 10.1],
          [55.2, 10.2],
        ],
      ),
      channel,
    );

    expect(metrics).toMatchObject({
      presentCount: 3,
      nonZeroCount: 0,
      allZero: true,
      constantValue: true,
      distinctPositionCount: 2,
    });
    expect(
      passesExecutedChannelQualityFilters(metrics, USEFUL_CHANNEL_FILTERS),
    ).toBe(false);
    expect(
      passesExecutedChannelQualityFilters(metrics, SHOW_ALL_CHANNEL_FILTERS),
    ).toBe(true);
  });

  it("detects channels whose values all share one location", () => {
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [10, 20, 30],
        [
          [55, 10],
          [55, 10],
          [55, 10],
        ],
      ),
      channel,
    );

    expect(metrics).toMatchObject({
      allZero: false,
      distinctValueCount: 2,
      positionedValueCount: 3,
      distinctPositionCount: 1,
      singlePosition: true,
    });
    expect(
      passesExecutedChannelQualityFilters(metrics, USEFUL_CHANNEL_FILTERS),
    ).toBe(false);
  });

  it("normalizes small GPS differences into one physical location", () => {
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [10, 20, 30],
        [
          [55.976714, 10.22238],
          [55.976723, 10.222397],
          [55.976732, 10.222414],
        ],
      ),
      channel,
    );

    expect(SINGLE_LOCATION_DIAMETER_METERS).toBe(5);
    expect(metrics).toMatchObject({
      positionedValueCount: 3,
      distinctPositionCount: 1,
      singlePosition: true,
    });
  });

  it("keeps positions outside the single-location cluster distinct", () => {
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [10, 20, 30],
        [
          [55.976714, 10.22238],
          [55.9768, 10.2225],
          [55.9769, 10.2227],
        ],
      ),
      channel,
    );

    expect(metrics).toMatchObject({
      distinctPositionCount: 2,
      singlePosition: false,
    });
  });

  it("can hide channels whose device value presentation is missing", () => {
    const missingPresentationChannel: TimeLogChannel = {
      ...channel,
      presentation: {
        ...channel.presentation,
        id: "missing",
        source: "No device value presentation",
        confidence: "missing",
      },
    };
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [10, 20, 30],
        [
          [55, 10],
          [55.1, 10.1],
          [55.2, 10.2],
        ],
      ),
      missingPresentationChannel,
    );

    expect(metrics.missingPresentation).toBe(true);
    expect(
      passesExecutedChannelQualityFilters(metrics, USEFUL_CHANNEL_FILTERS),
    ).toBe(false);
    expect(
      passesExecutedChannelQualityFilters(metrics, SHOW_ALL_CHANNEL_FILTERS),
    ).toBe(true);
  });

  it("keeps varying, positioned channels in the useful default view", () => {
    const metrics = summarizeTimeLogChannel(
      timeLog(
        [10, 20, 30],
        [
          [55, 10],
          [55.1, 10.1],
          [55.2, 10.2],
        ],
      ),
      channel,
    );

    expect(
      passesExecutedChannelQualityFilters(metrics, USEFUL_CHANNEL_FILTERS),
    ).toBe(true);
  });
});
