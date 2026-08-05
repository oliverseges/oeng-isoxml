import { describe, expect, it } from "vitest";
import {
  BASEMAP_NATIVE_MAX_ZOOM,
  BASEMAP_ZOOM_OPTIONS,
  MAP_MAX_ZOOM,
} from "@/components/viewer/map-options";

describe("map zoom options", () => {
  it("keeps basemap tiles visible beyond their native zoom", () => {
    expect(BASEMAP_ZOOM_OPTIONS.maxNativeZoom).toBe(BASEMAP_NATIVE_MAX_ZOOM);
    expect(BASEMAP_ZOOM_OPTIONS.maxZoom).toBe(MAP_MAX_ZOOM);
    expect(MAP_MAX_ZOOM).toBeGreaterThan(BASEMAP_NATIVE_MAX_ZOOM);
  });
});
