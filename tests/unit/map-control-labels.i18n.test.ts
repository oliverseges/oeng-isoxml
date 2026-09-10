import { describe, expect, it } from "vitest";
import { executedOutlierControlLabel } from "@/components/viewer/map-control-labels";

describe("localized map control labels", () => {
  it("formats the executed outlier label in the selected locale", () => {
    expect(executedOutlierControlLabel(false, 8, "de")).toBe(
      "8 Extremwerte ausblenden (konservatives 3× IQR)",
    );
    expect(executedOutlierControlLabel(true, 1, "sv")).toBe(
      "Visa 1 extremt värde som nu är dolt",
    );
  });
});