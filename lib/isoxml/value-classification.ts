export const DEFAULT_MAX_VALUE_CLASSES = 10;

export type ValueClassificationMode = "distinct-values" | "equal-interval";

export interface ValueClassification {
  mode: ValueClassificationMode;
  classCount: number;
  min: number;
  max: number;
  distinctValues: number[];
}

export function classifyValues(
  values: ArrayLike<number>,
  maxClasses = DEFAULT_MAX_VALUE_CLASSES,
  excluded?: ArrayLike<number>,
): ValueClassification {
  const classLimit = Number.isFinite(maxClasses)
    ? Math.max(1, Math.floor(maxClasses))
    : DEFAULT_MAX_VALUE_CLASSES;
  const distinctValueSet = new Set<number>();
  let hasMoreValuesThanClasses = false;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    if (excluded?.[index]) continue;
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (!hasMoreValuesThanClasses) {
      distinctValueSet.add(value);
      if (distinctValueSet.size > classLimit) {
        hasMoreValuesThanClasses = true;
        distinctValueSet.clear();
      }
    }
  }

  const distinctValues = Array.from(distinctValueSet).sort(
    (left, right) => left - right,
  );

  if (!Number.isFinite(min)) {
    return {
      mode: "distinct-values",
      classCount: 0,
      min: 0,
      max: 0,
      distinctValues,
    };
  }

  return {
    mode: hasMoreValuesThanClasses ? "equal-interval" : "distinct-values",
    classCount: hasMoreValuesThanClasses ? classLimit : distinctValues.length,
    min,
    max,
    distinctValues,
  };
}

export function classIndexForValue(
  value: number,
  classification: ValueClassification,
): number | undefined {
  if (!Number.isFinite(value) || classification.classCount === 0) {
    return undefined;
  }

  if (classification.mode === "distinct-values") {
    const index = classification.distinctValues.indexOf(value);
    return index >= 0 ? index : undefined;
  }

  if (classification.max === classification.min) return 0;
  const ratio = Math.max(
    0,
    Math.min(
      1,
      (value - classification.min) / (classification.max - classification.min),
    ),
  );
  return Math.min(
    classification.classCount - 1,
    Math.floor(ratio * classification.classCount),
  );
}
