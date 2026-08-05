import { describe, expect, it } from "vitest";
import {
  executedChannelTreeLabel,
  isTreeChannelActive,
  isTreeNodeInDataScope,
} from "@/components/viewer/tree-selection";

describe("dataset-tree channel selection", () => {
  it("does not treat two missing channel identifiers as an active match", () => {
    expect(isTreeChannelActive({}, undefined, "executed-channel")).toBe(false);
    expect(isTreeChannelActive({}, "planned-channel", undefined)).toBe(false);
  });

  it("activates only the matching planned or executed channel", () => {
    expect(
      isTreeChannelActive(
        { timeLogChannelId: "executed-channel" },
        undefined,
        "executed-channel",
      ),
    ).toBe(true);
    expect(
      isTreeChannelActive(
        { timeLogChannelId: "other-channel" },
        undefined,
        "executed-channel",
      ),
    ).toBe(false);
  });

  it("shows the DDI dictionary name in executed channel rows", () => {
    expect(
      executedChannelTreeLabel({
        ddiDisplay: "008D",
        ddiName: "Actual Work State",
      }),
    ).toBe("DDI 008D · Actual Work State");
  });

  it("filters planned and executed branches while retaining both by default", () => {
    expect(isTreeNodeInDataScope("planned", "both")).toBe(true);
    expect(isTreeNodeInDataScope("executed", "planned")).toBe(false);
    expect(isTreeNodeInDataScope("planned", "planned")).toBe(true);
    expect(isTreeNodeInDataScope(undefined, "executed")).toBe(false);
  });
});
