import { zip as zipShapefile } from "@mapbox/shp-write";
import {
  createI18n,
  DEFAULT_LOCALE,
  type SupportedLocale,
} from "../client/i18n";
import { geographicCellBounds, geographicCellCenter } from "./spatial";
import type {
  DecodedGrid,
  DecodedTimeLog,
  GridChannel,
  IsoXmlDataset,
  TimeLogChannel,
} from "./types";
import { decodeValue } from "./value-decoder";

function escapeCsv(value: unknown): string {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function channelIndexFor(grid: DecodedGrid, channel: GridChannel): number {
  const channelIndex = grid.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  if (channelIndex < 0 || !grid.rawValues[channelIndex]) {
    throw new Error(
      `Channel ${channel.channelId} does not belong to grid ${grid.id}.`,
    );
  }
  return channelIndex;
}

function timeLogChannelIndexFor(
  timeLog: DecodedTimeLog,
  channel: TimeLogChannel,
): number {
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  if (channelIndex < 0 || !timeLog.rawValues[channelIndex]) {
    throw new Error(
      `Channel ${channel.channelId} does not belong to time log ${timeLog.id}.`,
    );
  }
  return channelIndex;
}

export function gridChannelCsv(
  grid: DecodedGrid,
  channel: GridChannel,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const i18n = createI18n(locale);
  const channelIndex = channelIndexFor(grid, channel);
  const rows = [
    [
      i18n.t("Task ID"),
      i18n.t("Grid ID"),
      i18n.t("Source file"),
      i18n.t("Cell index"),
      i18n.t("Row"),
      i18n.t("Column"),
      i18n.t("Latitude"),
      i18n.t("Longitude"),
      i18n.t("Treatment zone"),
      i18n.t("PDV index"),
      "ddi",
      i18n.t("Product"),
      i18n.t("Device element"),
      i18n.t("Raw value"),
      i18n.t("Scaled value"),
      i18n.t("Unit"),
      i18n.t("Derived"),
    ],
  ];
  for (let index = 0; index < grid.decodedCellCount; index += 1) {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const coordinate = geographicCellCenter(grid, row, column);
    const decoded = decodeValue(
      grid.rawValues[channelIndex][index],
      channel.presentation,
    );
    rows.push([
      grid.taskId,
      grid.id,
      grid.filename,
      String(index),
      String(row),
      String(column),
      coordinate?.latitude.toFixed(7) ?? "",
      coordinate?.longitude.toFixed(7) ?? "",
      grid.gridType === 1 ? String(grid.treatmentZoneCodes[index]) : "",
      String(channel.pdvIndex),
      channel.ddiDisplay,
      channel.productName ?? "",
      channel.deviceElementName ?? "",
      String(decoded.rawValue),
      decoded.formattedValue,
      channel.unit ?? "",
      "false",
    ]);
  }
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

export function timeLogChannelCsv(
  timeLog: DecodedTimeLog,
  channel: TimeLogChannel,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const i18n = createI18n(locale);
  const channelIndex = timeLogChannelIndexFor(timeLog, channel);
  const rows: unknown[][] = [
    [
      i18n.t("Task ID"),
      i18n.t("Time-log ID"),
      i18n.t("Source file"),
      i18n.t("Record index"),
      i18n.t("Timestamp"),
      i18n.t("Latitude"),
      i18n.t("Longitude"),
      i18n.t("Position status"),
      i18n.t("Position valid"),
      i18n.t("DLV index"),
      "ddi",
      i18n.t("Machine"),
      i18n.t("Device element"),
      i18n.t("Value present"),
      i18n.t("Raw value"),
      i18n.t("Scaled value"),
      i18n.t("Unit"),
    ],
  ];
  for (let index = 0; index < timeLog.decodedRecordCount; index += 1) {
    const present = Boolean(timeLog.valuePresent[channelIndex][index]);
    const rawValue = present
      ? timeLog.rawValues[channelIndex][index]
      : undefined;
    const decoded =
      rawValue === undefined
        ? undefined
        : decodeValue(rawValue, channel.presentation);
    rows.push([
      timeLog.taskId,
      timeLog.id,
      timeLog.filename,
      index,
      new Date(timeLog.timestamps[index]).toISOString(),
      Number.isFinite(timeLog.latitudes[index])
        ? timeLog.latitudes[index].toFixed(7)
        : "",
      Number.isFinite(timeLog.longitudes[index])
        ? timeLog.longitudes[index].toFixed(7)
        : "",
      timeLog.positionStatus[index],
      Boolean(timeLog.validPositions[index]),
      channel.dlvIndex,
      channel.ddiDisplay,
      channel.deviceName ?? "",
      channel.deviceElementName ?? "",
      present,
      rawValue ?? "",
      decoded?.numericValue ?? "",
      channel.unit ?? "",
    ]);
  }
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

export function gridChannelGeoJson(
  dataset: IsoXmlDataset,
  grid: DecodedGrid,
  channel: GridChannel,
): string {
  const channelIndex = channelIndexFor(grid, channel);
  const features = Array.from({ length: grid.decodedCellCount }, (_, index) => {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const bounds = geographicCellBounds(grid, row, column);
    if (!bounds) return undefined;
    const { north, south, west, east } = bounds;
    const decoded = decodeValue(
      grid.rawValues[channelIndex][index],
      channel.presentation,
    );
    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
      properties: {
        taskId: grid.taskId,
        gridId: grid.id,
        sourceFile: grid.filename,
        cellIndex: index,
        row,
        column,
        treatmentZone:
          grid.gridType === 1 ? grid.treatmentZoneCodes[index] : undefined,
        pdvIndex: channel.pdvIndex,
        ddi: channel.ddiDisplay,
        product: channel.productName,
        deviceElement: channel.deviceElementName,
        rawValue: decoded.rawValue,
        scaledValue: decoded.numericValue,
        formattedValue: decoded.formattedValue,
        unit: channel.unit,
        derived: false,
      },
    };
  }).filter((feature) => feature !== undefined);
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: `${dataset.title} · ${channel.label}`,
      features,
    },
    null,
    2,
  );
}

export async function gridChannelShapefileZip(
  dataset: IsoXmlDataset,
  grid: DecodedGrid,
  channel: GridChannel,
): Promise<Blob> {
  const baseName = safeDownloadFilename(
    `${grid.id}-${channel.ddiDisplay}-${channel.productId ?? "channel"}`,
  );
  const geoJson = JSON.parse(gridChannelGeoJson(dataset, grid, channel));

  return zipShapefile<"blob">(geoJson, {
    compression: "DEFLATE",
    outputType: "blob",
    folder: safeDownloadFilename(dataset.title),
    filename: baseName,
    types: {
      polygon: baseName,
    },
  });
}

export function timeLogChannelGeoJson(
  dataset: IsoXmlDataset,
  timeLog: DecodedTimeLog,
  channel: TimeLogChannel,
): string {
  const channelIndex = timeLogChannelIndexFor(timeLog, channel);
  const features = Array.from(
    { length: timeLog.decodedRecordCount },
    (_, index) => {
      const present = Boolean(timeLog.valuePresent[channelIndex][index]);
      const rawValue = present
        ? timeLog.rawValues[channelIndex][index]
        : undefined;
      const decoded =
        rawValue === undefined
          ? undefined
          : decodeValue(rawValue, channel.presentation);
      const latitude = timeLog.latitudes[index];
      const longitude = timeLog.longitudes[index];
      const hasPoint =
        Boolean(timeLog.validPositions[index]) &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude);

      return {
        type: "Feature",
        geometry: hasPoint
          ? {
              type: "Point",
              coordinates: [longitude, latitude],
            }
          : null,
        properties: {
          taskId: timeLog.taskId,
          timeLogId: timeLog.id,
          sourceFile: timeLog.filename,
          recordIndex: index,
          timestamp: new Date(timeLog.timestamps[index]).toISOString(),
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          positionStatus: timeLog.positionStatus[index],
          positionValid: Boolean(timeLog.validPositions[index]),
          dlvIndex: channel.dlvIndex,
          ddi: channel.ddiDisplay,
          machine: channel.deviceName,
          deviceElement: channel.deviceElementName,
          valuePresent: present,
          rawValue: rawValue ?? null,
          scaledValue: decoded?.numericValue ?? null,
          formattedValue: decoded?.formattedValue ?? null,
          unit: channel.unit,
        },
      };
    },
  );

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: `${dataset.title} · ${channel.label}`,
      features,
    },
    null,
    2,
  );
}

export async function timeLogChannelShapefileZip(
  dataset: IsoXmlDataset,
  timeLog: DecodedTimeLog,
  channel: TimeLogChannel,
): Promise<Blob> {
  const baseName = safeDownloadFilename(
    `${timeLog.id}-${channel.ddiDisplay}-${channel.deviceElementId ?? "channel"}`,
  );
  const geoJson = JSON.parse(timeLogChannelGeoJson(dataset, timeLog, channel));
  geoJson.features = geoJson.features.filter(
    (feature: { geometry: { type: string } | null }) =>
      feature.geometry?.type === "Point",
  );

  return zipShapefile<"blob">(geoJson, {
    compression: "DEFLATE",
    outputType: "blob",
    folder: safeDownloadFilename(dataset.title),
    filename: baseName,
    types: {
      point: baseName,
    },
  });
}

function safeDownloadFilename(filename: string): string {
  const cleaned = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[.\s]+$/g, "")
    .slice(0, 180);
  return cleaned || "download";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeDownloadFilename(filename);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 10_000);
}

export function downloadText(
  content: string,
  filename: string,
  type: string,
): void {
  downloadBlob(new Blob([content], { type }), filename);
}
