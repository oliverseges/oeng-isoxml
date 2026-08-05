export function executedOutlierControlLabel(
  hideOutliers: boolean,
  outlierCount: number,
): string {
  if (outlierCount <= 0) {
    return hideOutliers
      ? "Turn off outlier filter; no extreme values are hidden"
      : "Outlier filter; no extreme values detected";
  }

  const values = `${outlierCount.toLocaleString()} extreme ${
    outlierCount === 1 ? "value" : "values"
  }`;
  return hideOutliers
    ? `Show ${values} currently hidden`
    : `Hide ${values} (conservative 3× IQR)`;
}
