import { describe, expect, it } from "vitest";
import {
  classIndexForValue,
  classifyValues,
} from "../../lib/isoxml/value-classification";

describe("value classification", () => {
  it("uses 10 equal-interval classes when there are more than 10 values", () => {
    const classification = classifyValues(
      Array.from({ length: 30 }, (_, index) => index),
    );

    expect(classification.mode).toBe("equal-interval");
    expect(classification.classCount).toBe(10);
    expect(classIndexForValue(0, classification)).toBe(0);
    expect(classIndexForValue(29, classification)).toBe(9);
  });

  it("uses one class per distinct value when there are fewer than 10", () => {
    const classification = classifyValues([9, 5, 7, 5, 9]);

    expect(classification.mode).toBe("distinct-values");
    expect(classification.classCount).toBe(3);
    expect(classIndexForValue(5, classification)).toBe(0);
    expect(classIndexForValue(7, classification)).toBe(1);
    expect(classIndexForValue(9, classification)).toBe(2);
  });

  it("uses a single class for one repeated value", () => {
    const classification = classifyValues([6, 6, 6]);

    expect(classification.classCount).toBe(1);
    expect(classIndexForValue(6, classification)).toBe(0);
  });

  it("ignores non-finite values", () => {
    const classification = classifyValues([Number.NaN, Infinity, 4]);

    expect(classification.distinctValues).toEqual([4]);
    expect(classIndexForValue(Number.NaN, classification)).toBeUndefined();
  });

  it("classifies typed values without copying excluded cells", () => {
    const classification = classifyValues(
      Float64Array.of(1, 2, 100),
      10,
      Uint8Array.of(0, 0, 1),
    );

    expect(classification.distinctValues).toEqual([1, 2]);
    expect(classification.max).toBe(2);
  });
});
