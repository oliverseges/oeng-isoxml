import { pointIsInsideBoundary } from "./spatial";
import type { SpatialBoundary } from "./types";

interface ExecutedMapFilterOptions {
  hideZeroValues: boolean;
  hideOutliers: boolean;
  clipToField: boolean;
  fieldBoundary?: SpatialBoundary;
}

export function buildExecutedMapExcludedMask(
  numericValues: Float64Array,
  outlierMask: Uint8Array,
  latitudes: Float64Array,
  longitudes: Float64Array,
  options: ExecutedMapFilterOptions,
): Uint8Array {
  const mask = new Uint8Array(numericValues.length);
  const fieldBoundary = options.clipToField ? options.fieldBoundary : undefined;

  for (let index = 0; index < mask.length; index += 1) {
    const value = numericValues[index];
    if (!Number.isFinite(value)) continue;
    const outsideField =
      fieldBoundary !== undefined &&
      !pointIsInsideBoundary(
        latitudes[index],
        longitudes[index],
        fieldBoundary,
      );
    if (
      (options.hideZeroValues && value === 0) ||
      (options.hideOutliers && Boolean(outlierMask[index])) ||
      outsideField
    ) {
      mask[index] = 1;
    }
  }
  return mask;
}
