import { describe, expect, it } from "vitest";
import { decodeValue } from "@/lib/isoxml/value-decoder";

describe("value decoder", () => {
  it("preserves the raw integer and applies the declared formula", () => {
    const value = decodeValue(1123, {
      id: "VPN1",
      offset: "-3",
      scale: "0.1",
      decimals: 1,
      unit: "L/ha",
      source: "VPN VPN1",
      confidence: "declared",
    });

    expect(value.rawValue).toBe(1123);
    expect(value.numericValue).toBe(112);
    expect(value.formattedValue).toBe("112.0");
    expect(value.formula).toBe("(1123 + -3) × 0.1");
  });

  it("uses decimal-safe arithmetic for values awkward in binary floating point", () => {
    const value = decodeValue(2, {
      id: "VPN-DECIMAL",
      offset: "0.1",
      scale: "0.1",
      decimals: 2,
      source: "test",
      confidence: "declared",
    });
    expect(value.formattedValue).toBe("0.21");
  });

  it("keeps zero distinct from missing", () => {
    const value = decodeValue(0, {
      id: "VPN3",
      offset: "0",
      scale: "1",
      decimals: 0,
      unit: "%",
      source: "VPN VPN3",
      confidence: "declared",
    });
    expect(value.status).toBe("valid");
    expect(value.formattedValue).toBe("0");
  });
});
