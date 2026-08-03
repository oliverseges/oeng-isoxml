import { describe, expect, it } from "vitest";
import {
  describeDdi,
  ISOBUS_DDI_COUNT,
  ISOBUS_DICTIONARY_VERSION,
  parseDdi,
  refreshDatasetDdiMetadata,
} from "@/lib/isoxml/ddi-service";
import {
  describeDdiDetails,
  ISOBUS_DEVICE_CLASSES,
  ISOBUS_UNITS,
} from "@/lib/isoxml/ddi-catalog";
import type { IsoXmlDataset } from "@/lib/isoxml/types";

describe("DDI service", () => {
  it("resolves zero-padded DDI 0006 to the official mass-per-area label", () => {
    const ddi = parseDdi("0006");

    expect(ddi).toBe(6);
    expect(describeDdiDetails(ddi)).toMatchObject({
      name: "Setpoint Mass Per Area Application Rate",
      description: "Setpoint Application Rate specified as mass per area",
      source: "ISOBUS Data Dictionary 2026050501",
      officialUrl: "https://www.isobus.net/isobus/dDEntity/21",
      unitSymbol: "mg/m²",
      bitResolution: "1",
      deviceClasses: [
        { id: 4, name: "Planters /Seeders" },
        { id: 5, name: "Fertilizer" },
        { id: 6, name: "Sprayers" },
      ],
    });
  });

  it("keeps unbundled identifiers explicit instead of guessing", () => {
    expect(describeDdi(65_534).name).toBe("Unknown DDI");
  });

  it("bundles all eight official listing pages and their supporting catalogs", () => {
    expect(ISOBUS_DICTIONARY_VERSION).toBe("2026050501");
    expect(ISOBUS_DDI_COUNT).toBe(765);
    expect(ISOBUS_UNITS).toHaveLength(49);
    expect(ISOBUS_DEVICE_CLASSES).toHaveLength(29);
    expect(describeDdiDetails(83).officialUrl).toBe(
      "https://www.isobus.net/isobus/dDEntity/6",
    );
    expect(describeDdiDetails(100).officialUrl).toBe(
      "https://www.isobus.net/isobus/dDEntity/96",
    );
  });

  it("refreshes stale DDI labels restored from local storage", () => {
    const staleDataset = {
      grids: [
        {
          channels: [
            {
              ddi: 6,
              ddiName: "Unknown DDI",
              dictionarySource: "No dictionary match",
            },
          ],
        },
      ],
    } as IsoXmlDataset;

    const refreshed = refreshDatasetDdiMetadata(staleDataset);

    expect(refreshed.grids[0].channels[0]).toMatchObject({
      ddi: 6,
      ddiName: "Setpoint Mass Per Area Application Rate",
      dictionarySource: "ISOBUS Data Dictionary 2026050501",
    });
    expect(staleDataset.grids[0].channels[0].ddiName).toBe("Unknown DDI");
  });
});
