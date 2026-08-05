import { describe, expect, it } from "vitest";
import { executedOutlierControlLabel } from "@/components/viewer/map-control-labels";

describe("map control labels", () => {
  it("describes the action and count for the executed outlier filter", () => {
    expect(executedOutlierControlLabel(false, 8)).toBe(
      "Hide 8 extreme values (conservative 3× IQR)",
    );
    expect(executedOutlierControlLabel(true, 8)).toBe(
      "Show 8 extreme values currently hidden",
    );
  });

  it("explains when the selected channel has no detected outliers", () => {
    expect(executedOutlierControlLabel(false, 0)).toBe(
      "Outlier filter; no extreme values detected",
    );
  });
});
