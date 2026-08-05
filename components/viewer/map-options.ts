export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 21;
export const BASEMAP_NATIVE_MAX_ZOOM = 19;

export const BASEMAP_ZOOM_OPTIONS = {
  maxNativeZoom: BASEMAP_NATIVE_MAX_ZOOM,
  maxZoom: MAP_MAX_ZOOM,
} as const;
