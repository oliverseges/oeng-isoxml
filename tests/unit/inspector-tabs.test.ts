import { describe, expect, it } from "vitest";
import {
  INSPECTOR_TABS,
  TIME_LOG_INSPECTOR_TABS,
  visibleInspectorTab,
} from "@/components/viewer/inspector-tabs";

describe("inspector tabs", () => {
  it("adds Adapter only for executed time-log inspection", () => {
    expect(INSPECTOR_TABS.map((tab) => tab.id)).toEqual([
      "overview",
      "attributes",
      "relationships",
      "source",
      "validation",
    ]);
    expect(TIME_LOG_INSPECTOR_TABS.at(-1)).toEqual({
      id: "adapter",
      label: "Adapter",
    });
  });

  it("falls back to Overview if Adapter is retained for a planned selection", () => {
    expect(visibleInspectorTab("adapter", false)).toBe("overview");
    expect(visibleInspectorTab("adapter", true)).toBe("adapter");
  });
});
