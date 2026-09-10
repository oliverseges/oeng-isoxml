import {
  createI18n,
  detectPreferredLocale,
  SUPPORTED_LOCALES,
} from "@/lib/client/i18n";
import { describe, expect, it } from "vitest";

describe("client i18n", () => {
  it("exposes the configured locale options", () => {
    expect(SUPPORTED_LOCALES.map((entry) => entry.code)).toEqual([
      "en",
      "da",
      "pl",
      "sv",
      "de",
    ]);
  });

  it("translates fixed and pluralized labels", () => {
    const en = createI18n("en");
    const da = createI18n("da");

    expect(en.t("topBar.import")).toBe("Import");
    expect(da.t("topBar.import")).toBe("Importer");
    expect(en.t("counts.files", { count: 1 })).toBe("1 file");
    expect(en.t("counts.files", { count: 2 })).toBe("2 files");
    expect(da.t("counts.files", { count: 1 })).toBe("1 fil");
    expect(da.t("counts.files", { count: 3 })).toBe("3 filer");
  });

  it("formats numbers and dates for the selected locale", () => {
    const en = createI18n("en");
    const de = createI18n("de");
    const instant = Date.UTC(2026, 0, 2, 13, 5, 0);

    expect(en.formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe(
      "12,345.6",
    );
    expect(de.formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe(
      "12.345,6",
    );
    expect(de.formatTime(instant, { timeZone: "UTC" })).toContain("13:05");
    expect(en.formatDateTime(instant)).toContain("2026");
  });

  it("detects the preferred locale from browser language candidates", () => {
    expect(detectPreferredLocale(["sv-SE", "en-US"])).toBe("sv");
    expect(detectPreferredLocale(["fr-FR", "de-DE"])).toBe("de");
    expect(detectPreferredLocale(["fr-FR"])).toBe("en");
  });
});
