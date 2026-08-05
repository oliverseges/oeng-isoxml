import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const fixtureUrl = new URL(
  "../output/playwright/performance-fixture/",
  import.meta.url,
);
const fixturePath = fileURLToPath(fixtureUrl);
const gridRows = 200;
const gridColumns = 200;
const gridCellCount = gridRows * gridColumns;
const timeLogRecordCount = 50_000;
const timeLogRecordBytes = 21;
const gridOriginLatitude = 55.67;
const gridOriginLongitude = 12.43;
const gridLatitudeStep = 0.00002;
const gridLongitudeStep = 0.000035;
const gridBinary = Buffer.alloc(gridCellCount * 4);
const timeLogBinary = Buffer.alloc(timeLogRecordCount * timeLogRecordBytes);

for (let index = 0; index < gridCellCount; index += 1) {
  const row = Math.floor(index / gridColumns);
  const column = index % gridColumns;
  const value = Math.round(
    500 +
      160 * Math.sin(column / 13) +
      90 * Math.cos(row / 17) +
      ((row + column) % 31),
  );
  gridBinary.writeInt32LE(value, index * 4);
}

for (let index = 0; index < timeLogRecordCount; index += 1) {
  const offset = index * timeLogRecordBytes;
  const row = Math.floor(index / 250) % 200;
  const columnInPass = index % 250;
  const column = row % 2 ? 249 - columnInPass : columnInPass;
  const latitude = gridOriginLatitude + row * gridLatitudeStep;
  const longitude = gridOriginLongitude + column * (gridLongitudeStep * 0.8);
  timeLogBinary.writeUInt32LE(index * 100, offset);
  timeLogBinary.writeUInt16LE(17_000, offset + 4);
  timeLogBinary.writeInt32LE(Math.round(latitude * 10_000_000), offset + 6);
  timeLogBinary.writeInt32LE(Math.round(longitude * 10_000_000), offset + 10);
  timeLogBinary.writeUInt8(4, offset + 14);
  timeLogBinary.writeUInt8(1, offset + 15);
  timeLogBinary.writeUInt8(0, offset + 16);
  timeLogBinary.writeInt32LE(
    Math.round(500 + 120 * Math.sin(index / 97)),
    offset + 17,
  );
}

const north = gridOriginLatitude + gridRows * gridLatitudeStep;
const east = gridOriginLongitude + gridColumns * gridLongitudeStep;
const taskData = `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="4" VersionMinor="3" ManagementSoftwareManufacturer="OENG Labs" ManagementSoftwareVersion="performance-fixture">
  <PFD A="PFD-PERF" B="PERFORMANCE" C="Performance field">
    <PLN A="PLN-PERF"><LSG A="1">
      <PNT A="1" C="${gridOriginLatitude}" D="${gridOriginLongitude}" />
      <PNT A="1" C="${north}" D="${gridOriginLongitude}" />
      <PNT A="1" C="${north}" D="${east}" />
      <PNT A="1" C="${gridOriginLatitude}" D="${east}" />
      <PNT A="1" C="${gridOriginLatitude}" D="${gridOriginLongitude}" />
    </LSG></PLN>
  </PFD>
  <PDT A="PDT-PERF" B="Synthetic performance channel" />
  <VPN A="VPN-PERF" B="0" C="0.1" D="1" E="kg/ha" />
  <DVC A="DVC-PERF" B="Performance machine">
    <DET A="DET-PERF" B="1" C="3" D="Performance element" E="1" F="0"><DOR A="DPD-PERF" /></DET>
    <DPD A="DPD-PERF" B="0006" F="DVP-PERF" />
    <DVP A="DVP-PERF" B="0" C="0.1" D="1" E="kg/ha" />
  </DVC>
  <TSK A="TSK-PERF" B="40k cells and 50k points" E="PFD-PERF" G="4">
    <TZN A="1" B="Performance zone"><PDV A="0006" B="0" C="PDT-PERF" D="DET-PERF" E="VPN-PERF" /></TZN>
    <GRD A="${gridOriginLatitude}" B="${gridOriginLongitude}" C="${gridLatitudeStep}" D="${gridLongitudeStep}" E="${gridColumns}" F="${gridRows}" G="GRD90000" H="${gridBinary.byteLength}" I="2" J="2" />
    <TLG A="TLG90000" B="${timeLogBinary.byteLength}" C="1" />
  </TSK>
</ISO11783_TaskData>
`;
const timeLogHeader = `<?xml version="1.0" encoding="UTF-8"?>
<TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="0006" B="" C="DET-PERF"/></TIM>
`;

await mkdir(fixturePath, { recursive: true });
const archive = new JSZip();
archive.file("TASKDATA.XML", taskData);
archive.file("GRD90000.BIN", gridBinary);
archive.file("TLG90000.XML", timeLogHeader);
archive.file("TLG90000.BIN", timeLogBinary);
const archiveBytes = await archive.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});
await Promise.all([
  writeFile(new URL("TASKDATA.XML", fixtureUrl), taskData, "utf8"),
  writeFile(new URL("GRD90000.BIN", fixtureUrl), gridBinary),
  writeFile(new URL("TLG90000.XML", fixtureUrl), timeLogHeader, "utf8"),
  writeFile(new URL("TLG90000.BIN", fixtureUrl), timeLogBinary),
  writeFile(new URL("PERFORMANCE.ISOXML.zip", fixtureUrl), archiveBytes),
]);

console.log(
  `Generated ${gridCellCount.toLocaleString()} cells and ${timeLogRecordCount.toLocaleString()} points in ${fixturePath}`,
);
