import Decimal from "decimal.js";
import type { ValuePresentation } from "./types";

export interface DecodedValue {
  rawValue: number;
  numericValue?: number;
  formattedValue: string;
  unit?: string;
  status: "valid" | "missing" | "invalid" | "ambiguous";
  formula: string;
}

export function decodeValue(
  rawValue: number,
  presentation: ValuePresentation,
): DecodedValue {
  const formula = `(${rawValue} + ${presentation.offset}) × ${presentation.scale}`;
  if (!Number.isInteger(rawValue)) {
    return {
      rawValue,
      formattedValue: "Invalid raw value",
      unit: presentation.unit,
      status: "invalid",
      formula,
    };
  }
  try {
    const result = new Decimal(rawValue)
      .plus(new Decimal(presentation.offset))
      .times(new Decimal(presentation.scale));
    const formatted = result.toFixed(Math.max(0, presentation.decimals));
    return {
      rawValue,
      numericValue: result.toNumber(),
      formattedValue: formatted,
      unit: presentation.unit,
      status: presentation.confidence === "invalid" ? "invalid" : "valid",
      formula,
    };
  } catch {
    return {
      rawValue,
      formattedValue: String(rawValue),
      unit: presentation.unit,
      status: "invalid",
      formula,
    };
  }
}
