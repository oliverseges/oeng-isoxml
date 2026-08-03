import { decodeValue } from "./value-decoder";
import { geographicCellBounds, geographicCellCenter } from "./spatial";
import type { DecodedGrid, GridChannel, IsoXmlDataset } from "./types";

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

export function gridChannelCsv(
  grid: DecodedGrid,
  channel: GridChannel,
): string {
  const channelIndex = channelIndexFor(grid, channel);
  const rows = [
    [
      "task_id",
      "grid_id",
      "source_file",
      "cell_index",
      "row",
      "column",
      "latitude",
      "longitude",
      "treatment_zone",
      "pdv_index",
      "ddi",
      "product",
      "device_element",
      "raw_value",
      "scaled_value",
      "unit",
      "derived",
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
