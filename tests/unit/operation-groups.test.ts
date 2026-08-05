import { describe, expect, it } from "vitest";
import { operationGroupsForChannel } from "@/lib/isoxml/operation-groups";
import type { TimeLogChannel } from "@/lib/isoxml/types";

function channel(overrides: Partial<TimeLogChannel> = {}): TimeLogChannel {
  return {
    channelId: "channel-1",
    dlvIndex: 0,
    ddi: 6,
    ddiDisplay: "0006",
    ddiName: "Actual application rate",
    dictionarySource: "test",
    presentation: {
      id: "raw",
      offset: "0",
      scale: "1",
      decimals: 0,
      source: "test",
      confidence: "declared",
    },
    label: "DDI 0006 · Actual application rate",
    ...overrides,
  };
}

describe("executed operation groups", () => {
  it("uses official device classes for the main operation presets", () => {
    expect(operationGroupsForChannel(channel(), [4])).toContain("seeding");
    expect(operationGroupsForChannel(channel(), [5])).toContain("fertilizing");
    expect(operationGroupsForChannel(channel(), [6])).toContain(
      "plant-protection",
    );
  });

  it("keeps explicitly identified liming separate from generic fertilizing", () => {
    expect(
      operationGroupsForChannel(
        channel({ deviceName: "Kalk spreader", deviceElementName: "Lime" }),
        [5],
      ),
    ).toEqual(["liming"]);
  });

  it("places channels without operation evidence in Other", () => {
    expect(operationGroupsForChannel(channel(), [])).toEqual(["other"]);
  });
});
