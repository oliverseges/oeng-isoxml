import { extremeOutlierBounds } from "./outliers";
import type { ValuePresentation } from "./types";

const MISSING_INT32 = -2_147_483_648;
const MAX_OUTLIER_SAMPLE_VALUES = 100_000;

export interface MapChannelValues {
  numericValueByCell: Float64Array;
  noDataCells: Uint8Array;
  zeroCells: Uint8Array;
  emptyCells: Uint8Array;
  outlierCells: Uint8Array;
  outlierBounds?: { lower: number; upper: number };
}

/**
 * Builds compact, approximate numeric views for visualization and statistics.
 * Exact display formatting remains in value-decoder and is used on demand.
 */
export function buildMapChannelValues(
  rawValues: Int32Array | undefined,
  decodedCellCount: number,
  presentation: ValuePresentation,
): MapChannelValues {
  const count = Math.min(decodedCellCount, rawValues?.length ?? 0);
  const numericValueByCell = new Float64Array(count);
  numericValueByCell.fill(Number.NaN);
  const noDataCells = new Uint8Array(count);
  const zeroCells = new Uint8Array(count);
  const emptyCells = new Uint8Array(count);
  const offset = Number(presentation.offset);
  const scale = Number(presentation.scale);
  let nonZeroValueCount = 0;

  for (let index = 0; index < count; index += 1) {
    const rawValue = rawValues?.[index] ?? MISSING_INT32;
    const numericValue = (rawValue + offset) * scale;
    const noData =
      rawValue === MISSING_INT32 ||
      !Number.isFinite(offset) ||
      !Number.isFinite(scale) ||
      !Number.isFinite(numericValue);
    if (noData) {
      noDataCells[index] = 1;
      emptyCells[index] = 1;
      continue;
    }
    numericValueByCell[index] = numericValue;
    if (numericValue === 0) {
      zeroCells[index] = 1;
      emptyCells[index] = 1;
    } else {
      nonZeroValueCount += 1;
    }
  }

  const sampleSize = Math.min(nonZeroValueCount, MAX_OUTLIER_SAMPLE_VALUES);
  const nonZeroSample: number[] = [];
  let nonZeroOrdinal = 0;
  let sampleIndex = 0;
  for (
    let index = 0;
    index < numericValueByCell.length && sampleIndex < sampleSize;
    index += 1
  ) {
    const numericValue = numericValueByCell[index];
    if (!Number.isFinite(numericValue) || numericValue === 0) continue;
    const targetOrdinal =
      sampleSize <= 1
        ? 0
        : Math.round(
            (sampleIndex * (nonZeroValueCount - 1)) / (sampleSize - 1),
          );
    if (nonZeroOrdinal === targetOrdinal) {
      nonZeroSample.push(numericValue);
      sampleIndex += 1;
    }
    nonZeroOrdinal += 1;
  }

  const outlierBounds = extremeOutlierBounds(nonZeroSample);
  const outlierCells = new Uint8Array(count);
  if (outlierBounds) {
    numericValueByCell.forEach((numericValue, index) => {
      if (
        !noDataCells[index] &&
        numericValue !== 0 &&
        (numericValue < outlierBounds.lower ||
          numericValue > outlierBounds.upper)
      ) {
        outlierCells[index] = 1;
      }
    });
  }

  return {
    numericValueByCell,
    noDataCells,
    zeroCells,
    emptyCells,
    outlierCells,
    outlierBounds,
  };
}
