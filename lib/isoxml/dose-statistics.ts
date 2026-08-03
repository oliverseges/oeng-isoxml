export interface DoseStatistics {
  average?: number;
  averageUnit?: string;
  total?: number;
  totalUnit?: string;
}

function totalUnitForAreaRate(
  unit: string | undefined,
): { areaSquareMeters: number; unit: string } | undefined {
  if (!unit) return undefined;
  const normalized = unit
    .trim()
    .replace(/\s+/g, "")
    .replace(/m\^2/gi, "m²")
    .replace(/㎡/g, "m²");
  const match = normalized.match(/^(.*?)\/(ha|m²)$/i);
  if (!match) return undefined;
  return {
    areaSquareMeters: match[2].toLowerCase() === "ha" ? 10_000 : 1,
    unit: match[1] || "#",
  };
}

export function calculateDoseStatistics(
  values: ArrayLike<number>,
  cellAreaSquareMeters: number | undefined,
  unit: string | undefined,
  excluded?: ArrayLike<number>,
): DoseStatistics {
  let count = 0;
  let sum = 0;
  let compensation = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (excluded?.[index]) continue;
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const adjusted = value - compensation;
    const nextSum = sum + adjusted;
    compensation = nextSum - sum - adjusted;
    sum = nextSum;
    count += 1;
  }

  if (!count) return {};

  const statistics: DoseStatistics = {
    average: sum / count,
    averageUnit: unit,
  };
  const totalUnit = totalUnitForAreaRate(unit);
  if (
    totalUnit &&
    cellAreaSquareMeters !== undefined &&
    Number.isFinite(cellAreaSquareMeters) &&
    cellAreaSquareMeters > 0
  ) {
    statistics.total =
      (sum * cellAreaSquareMeters) / totalUnit.areaSquareMeters;
    statistics.totalUnit = totalUnit.unit;
  }
  return statistics;
}
