const EXTREME_IQR_MULTIPLIER = 3;
const MINIMUM_RELATIVE_FENCE = 0.5;

function quantile(sortedValues: number[], fraction: number): number {
  const position = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const interpolation = position - lowerIndex;
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[lowerIndex + 1] ?? lower;
  return lower + (upper - lower) * interpolation;
}

/**
 * Returns deliberately conservative bounds for obvious data errors.
 *
 * The 3× IQR fence is Tukey's "far out" threshold. A relative guard keeps a
 * nearly flat prescription from treating small, legitimate differences as
 * extreme merely because its IQR is zero or very small.
 */
export function extremeOutlierBounds(
  values: number[],
): { lower: number; upper: number } | undefined {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length < 4) return undefined;

  const firstQuartile = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const thirdQuartile = quantile(sorted, 0.75);
  const interquartileRange = thirdQuartile - firstQuartile;
  const referenceMagnitude = Math.max(
    Math.abs(firstQuartile),
    Math.abs(median),
    Math.abs(thirdQuartile),
  );
  const fenceDistance = Math.max(
    interquartileRange * EXTREME_IQR_MULTIPLIER,
    referenceMagnitude * MINIMUM_RELATIVE_FENCE,
    Number.EPSILON,
  );

  return {
    lower: firstQuartile - fenceDistance,
    upper: thirdQuartile + fenceDistance,
  };
}
