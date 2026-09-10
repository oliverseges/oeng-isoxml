import { describe, expect, it } from "vitest";
import {
  geographicDistanceMeters,
  polylineDistanceMeters,
} from "@/lib/isoxml/spatial";

describe("spatial distance helpers", () => {
  it("computes point-to-point distance in meters", () => {
    const distance = geographicDistanceMeters(
      { latitude: 55.0, longitude: 12.0 },
      { latitude: 55.0, longitude: 12.001 },
    );

    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(70);
  });

  it("sums polyline segment distances", () => {
    const total = polylineDistanceMeters([
      { latitude: 55.0, longitude: 12.0 },
      { latitude: 55.0, longitude: 12.001 },
      { latitude: 55.001, longitude: 12.001 },
    ]);

    expect(total).toBeGreaterThan(170);
    expect(total).toBeLessThan(190);
  });
});