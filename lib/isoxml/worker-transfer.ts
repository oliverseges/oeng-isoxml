import type { IsoXmlDataset } from "./types";

export function datasetTransferables(dataset: IsoXmlDataset): ArrayBuffer[] {
  const transfer = new Set<ArrayBuffer>();
  for (const bytes of Object.values(dataset.rawBytesByFile)) {
    transfer.add(bytes.buffer as ArrayBuffer);
  }
  for (const grid of dataset.grids) {
    transfer.add(grid.treatmentZoneCodes.buffer as ArrayBuffer);
    grid.rawValues.forEach((values) =>
      transfer.add(values.buffer as ArrayBuffer),
    );
  }
  for (const timeLog of dataset.timeLogs ?? []) {
    transfer.add(timeLog.timestamps.buffer as ArrayBuffer);
    transfer.add(timeLog.latitudes.buffer as ArrayBuffer);
    transfer.add(timeLog.longitudes.buffer as ArrayBuffer);
    transfer.add(timeLog.positionStatus.buffer as ArrayBuffer);
    transfer.add(timeLog.validPositions.buffer as ArrayBuffer);
    transfer.add(timeLog.recordByteOffsets.buffer as ArrayBuffer);
    timeLog.rawValues.forEach((values) =>
      transfer.add(values.buffer as ArrayBuffer),
    );
    timeLog.valuePresent.forEach((values) =>
      transfer.add(values.buffer as ArrayBuffer),
    );
  }
  return [...transfer];
}
