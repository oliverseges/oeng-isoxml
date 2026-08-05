import dictionaryData from "./data/isobus-ddi-core.json";
import type { IsoXmlDataset } from "./types";

export interface DdiSummary {
  ddi: number;
  name: string;
  source: string;
  officialUrl?: string;
}

type DdiCatalogEntry = readonly [ddi: number, recordId: number, name: string];

export const ISOBUS_DICTIONARY_VERSION = dictionaryData.version;
export const ISOBUS_DDI_COUNT = dictionaryData.entries.length;

const detailBaseUrl = dictionaryData.source.replace(/\/index$/, "");
const bundledDictionary = new Map<number, DdiSummary>(
  (dictionaryData.entries as unknown as DdiCatalogEntry[]).map(
    ([ddi, recordId, name]) => [
      ddi,
      {
        ddi,
        name,
        source: `ISOBUS Data Dictionary ${dictionaryData.version}`,
        officialUrl: `${detailBaseUrl}/${recordId}`,
      },
    ],
  ),
);

export function describeDdi(ddi: number): DdiSummary {
  return (
    bundledDictionary.get(ddi) ?? {
      ddi,
      name: "Unknown DDI",
      source: `ISOBUS Data Dictionary ${ISOBUS_DICTIONARY_VERSION}`,
      officialUrl: dictionaryData.source,
    }
  );
}

export function parseDdi(value: string | undefined): number {
  if (!value) return -1;
  const normalized = value.trim();
  if (/^0x[0-9a-f]+$/i.test(normalized)) {
    return Number.parseInt(normalized.slice(2), 16);
  }
  // ISOXML serializes ProcessDataDDI as four hexadecimal digits, including
  // values such as 0051 and 008D. Longer digit-only values are accepted as a
  // readable decimal extension for non-compact documents.
  if (/^[0-9a-f]{4}$/i.test(normalized)) {
    return Number.parseInt(normalized, 16);
  }
  if (/^[0-9]+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return -1;
}

export function formatDdi(ddi: number): string {
  return ddi >= 0 && ddi <= 0xffff
    ? ddi.toString(16).toUpperCase().padStart(4, "0")
    : "????";
}

export function refreshDatasetDdiMetadata(
  dataset: IsoXmlDataset,
): IsoXmlDataset {
  let changed = false;
  const grids = dataset.grids.map((grid) => {
    let gridChanged = false;
    const channels = grid.channels.map((channel) => {
      const ddiInfo = describeDdi(channel.ddi);
      if (
        channel.ddiName === ddiInfo.name &&
        channel.dictionarySource === ddiInfo.source
      ) {
        return channel;
      }
      changed = true;
      gridChanged = true;
      return {
        ...channel,
        ddiName: ddiInfo.name,
        dictionarySource: ddiInfo.source,
        label: `DDI ${channel.ddiDisplay} · ${ddiInfo.name} · ${channel.productName ?? "Product unresolved"}${channel.deviceElementName ? ` · ${channel.deviceElementName}` : ""}`,
      };
    });
    return gridChanged ? { ...grid, channels } : grid;
  });
  const timeLogs = (dataset.timeLogs ?? []).map((timeLog) => {
    let timeLogChanged = false;
    const channels = timeLog.channels.map((channel) => {
      const ddiInfo = describeDdi(channel.ddi);
      if (
        channel.ddiName === ddiInfo.name &&
        channel.dictionarySource === ddiInfo.source
      ) {
        return channel;
      }
      changed = true;
      timeLogChanged = true;
      return {
        ...channel,
        ddiName: ddiInfo.name,
        dictionarySource: ddiInfo.source,
        label: `DDI ${channel.ddiDisplay} · ${ddiInfo.name} · ${channel.deviceElementName ?? "Device element unresolved"}`,
      };
    });
    return timeLogChanged ? { ...timeLog, channels } : timeLog;
  });
  return changed || !dataset.timeLogs
    ? { ...dataset, grids, timeLogs }
    : dataset;
}
