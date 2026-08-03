import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyzePackageTransform } from "@/lib/isoxml/package-transform";
import { buildDataset } from "@/lib/isoxml/pipeline";
import {
  gridCellAreaSquareMeters,
  gridCellDimensionsMeters,
  gridCellRangeForBounds,
} from "@/lib/isoxml/spatial";
import type { IsoXmlDataset, ValidationIssue } from "@/lib/isoxml/types";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import { gridChannelCsv, gridChannelGeoJson } from "@/lib/isoxml/export";

const fixtureRoot = new URL("../../public/demo/", import.meta.url);

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function fixtureFiles(truncateBy = 0) {
  const [xml, binary] = await Promise.all([
    readFile(fileURLToPath(new URL("TASKDATA.XML", fixtureRoot))),
    readFile(fileURLToPath(new URL("GRD00001.BIN", fixtureRoot))),
  ]);
  const usableBinary =
    truncateBy > 0
      ? binary.subarray(0, binary.byteLength - truncateBy)
      : binary;
  return [
    { path: "TASKDATA.XML", buffer: arrayBuffer(xml) },
    { path: "GRD00001.BIN", buffer: arrayBuffer(usableBinary) },
  ];
}

function withCompatibleSecondTask(dataset: IsoXmlDataset): IsoXmlDataset {
  const copy = structuredClone(dataset);
  const sourceTask = copy.tasks[0];
  const sourceTaskObject = copy.objects.find(
    (object) => object.uid === sourceTask.objectUid,
  );
  if (!sourceTaskObject) throw new Error("Synthetic task object is missing.");

  const copiedTaskObject = structuredClone(sourceTaskObject);
  copiedTaskObject.uid = `${sourceTaskObject.uid}:copy`;
  copiedTaskObject.id = "TSK2";
  copiedTaskObject.attributes = {
    ...copiedTaskObject.attributes,
    A: "TSK2",
    B: "Second compatible task",
  };
  copy.objects.push(copiedTaskObject);
  copy.tasks.push({
    ...structuredClone(sourceTask),
    instanceId: `${sourceTask.instanceId}:copy`,
    id: "TSK2",
    objectUid: copiedTaskObject.uid,
    name: "Second compatible task",
    gridIds: ["GRD00002"],
  });
  copy.grids.push({
    ...structuredClone(copy.grids[0]),
    instanceId: `${copy.grids[0].instanceId}:copy`,
    id: "GRD00002",
    taskInstanceId: `${sourceTask.instanceId}:copy`,
    taskId: "TSK2",
    name: "GRD00002",
    filename: "GRD00002.BIN",
  });
  return copy;
}

describe("synthetic multi-PDV Type 2 vertical slice", () => {
  it("decodes three independent channels per cell", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const grid = dataset.grids[0];

    expect(grid.gridType).toBe(2);
    expect(grid.rows).toBe(6);
    expect(grid.columns).toBe(8);
    expect(grid.decodedCellCount).toBe(48);
    expect(grid.channels).toHaveLength(3);
    expect(grid.rawValues).toHaveLength(3);
    expect(grid.bytesPerCell).toBe(12);
    expect(grid.origin).toEqual({
      latitude: 55.67098,
      longitude: 12.43205,
    });
    expect(grid.cellSizeUnit).toBe("degrees");
    const cellDimensions = gridCellDimensionsMeters(grid);
    expect(cellDimensions?.northSouth).toBeCloseTo(20, 5);
    expect(cellDimensions?.eastWest).toBeCloseTo(20, 5);
    expect(gridCellAreaSquareMeters(grid)).toBeCloseTo(400, 0);
    expect(grid.originCorner).toBe("southwest");
    expect(grid.filename).toBe("GRD00001.BIN");
    expect(
      gridCellRangeForBounds(grid, {
        south: grid.origin.latitude,
        north: grid.origin.latitude + grid.cellSize.northSouth * 2,
        west: grid.origin.longitude,
        east: grid.origin.longitude + grid.cellSize.eastWest * 2,
      }),
    ).toEqual({ firstRow: 0, lastRow: 2, firstColumn: 0, lastColumn: 2 });
  });

  it("keeps repeated DDI channels separate by product and PDV order", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const grid = dataset.grids[0];
    const repeated = grid.channels.filter((channel) => channel.ddi === 1);

    expect(repeated).toHaveLength(2);
    expect(repeated.map((channel) => channel.productId)).toEqual([
      "PDT1",
      "PDT2",
    ]);
    expect(repeated.map((channel) => channel.pdvIndex)).toEqual([0, 1]);
    expect(new Set(repeated.map((channel) => channel.channelId)).size).toBe(2);
    expect(
      dataset.issues.some((issue) => issue.code === "MULTIPLE_PDV_SAME_DDI"),
    ).toBe(true);
  });

  it("resolves customer, farm, field, and worker task context", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");

    expect(dataset.tasks[0]).toMatchObject({
      customerId: "CTR1",
      customerName: "Green Valley Cooperative",
      farmId: "FRM1",
      farmName: "Hedgerow Farm",
      fieldId: "PFD1",
      fieldName: "North 40",
      workerId: "WKR1",
      workerName: "M. Jensen",
    });
  });

  it("reads signed little-endian integers and preserves scaled/raw values", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const grid = dataset.grids[0];
    const first = decodeValue(
      grid.rawValues[0][0],
      grid.channels[0].presentation,
    );

    expect(grid.rawValues[0][0]).toBe(915);
    expect(first.rawValue).toBe(915);
    expect(first.formattedValue).toBe("91.5");
  });

  it("exports the active channel defensively with valid polygon winding", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const grid = dataset.grids[0];
    const channel = grid.channels[0];
    const csv = gridChannelCsv(grid, channel);
    const geoJson = JSON.parse(gridChannelGeoJson(dataset, grid, channel));

    expect(csv.split("\r\n")).toHaveLength(grid.decodedCellCount + 1);
    expect(geoJson.features).toHaveLength(grid.decodedCellCount);
    expect(geoJson.features[0].geometry.coordinates[0][0][1]).toBeLessThan(
      geoJson.features[0].geometry.coordinates[0][2][1],
    );
    expect(() =>
      gridChannelCsv(grid, { ...channel, channelId: "missing" }),
    ).toThrow(/does not belong/);
  });

  it("reports a truncated binary while keeping complete records", async () => {
    const dataset = await buildDataset(
      await fixtureFiles(7),
      "truncated fixture",
    );
    const grid = dataset.grids[0];

    expect(grid.decodedCellCount).toBe(47);
    expect(
      grid.validationIssues.some(
        (issue) => issue.code === "GRID_BINARY_TRUNCATED",
      ),
    ).toBe(true);
    expect(grid.rawValues[0]).toHaveLength(47);
  });

  it("rejects unsafe grid dimensions without allocating declared cell arrays", async () => {
    const xml = new TextEncoder().encode(
      `<ISO11783_TaskData VersionMajor="4"><VPN A="VPN1" B="0" C="1" D="100000"/><TSK A="TSK1" B="Unsafe grid"><GRD A="55" B="12" C="0.0001" D="0.0001" E="1000000000" F="1000000000" G="GRD1" H="0" I="2"/><TZN A="1"><PDV A="0006" E="VPN1"/></TZN></TSK></ISO11783_TaskData>`,
    );
    const dataset = await buildDataset(
      [{ path: "TASKDATA.XML", buffer: arrayBuffer(xml) }],
      "unsafe dimensions",
    );
    const grid = dataset.grids[0];

    expect(grid.expectedCellCount).toBe(0);
    expect(grid.decodedCellCount).toBe(0);
    expect(grid.rawValues[0]).toHaveLength(0);
    expect(
      grid.validationIssues.some(
        (entry) => entry.code === "GRID_CELL_LIMIT_EXCEEDED",
      ),
    ).toBe(true);
    expect(
      grid.validationIssues.some(
        (entry) => entry.code === "VALUE_PRESENTATION_INVALID",
      ),
    ).toBe(true);
    expect(grid.channels[0].presentation.decimals).toBe(0);
  });

  it("keeps informational file notes from turning into warning status", async () => {
    const taskData = new TextEncoder().encode(
      `<ISO11783_TaskData VersionMajor="4"><TSK A="TSK1" B="Info only"/></ISO11783_TaskData>`,
    );
    const linkList = new TextEncoder().encode(
      `<ISO11783LinkList><LNK A="one"/><LNK A="two"/><LNK A="three"/></ISO11783LinkList>`,
    );
    const dataset = await buildDataset(
      [
        { path: "TASKDATA.XML", buffer: arrayBuffer(taskData) },
        { path: "LINKLIST.XML", buffer: arrayBuffer(linkList) },
      ],
      "info-only package",
    );

    expect(
      dataset.issues.filter((entry) => entry.code === "VIEWER_UNKNOWN_ELEMENT"),
    ).toHaveLength(2);
    expect(
      dataset.issues.find(
        (entry) =>
          entry.code === "VIEWER_UNKNOWN_ELEMENT" && entry.objectType === "LNK",
      )?.message,
    ).toContain("3 LNK elements");
    expect(
      dataset.files.find((file) => file.path === "LINKLIST.XML")
        ?.validationStatus,
    ).toBe("valid");
  });

  it("marks XML well-formedness invalid when a secondary XML file fails", async () => {
    const taskData = new TextEncoder().encode(
      `<ISO11783_TaskData VersionMajor="4"><TSK A="TSK1"/></ISO11783_TaskData>`,
    );
    const malformed = new TextEncoder().encode(`<BROKEN`);
    const dataset = await buildDataset(
      [
        { path: "TASKDATA.XML", buffer: arrayBuffer(taskData) },
        { path: "BROKEN.XML", buffer: arrayBuffer(malformed) },
      ],
      "malformed secondary XML",
    );

    expect(dataset.supportSummary.xmlWellFormed).toBe("invalid");
    expect(
      dataset.files.find((file) => file.path === "BROKEN.XML")
        ?.validationStatus,
    ).toBe("error");
  });

  it("recognizes task data by content and pairs a renamed binary by declared size", async () => {
    const [xml, binary] = await Promise.all([
      readFile(fileURLToPath(new URL("TASKDATA.XML", fixtureRoot))),
      readFile(fileURLToPath(new URL("GRD00001.BIN", fixtureRoot))),
    ]);
    const dataset = await buildDataset(
      [
        { path: "GRD00001 (renamed).bin", buffer: arrayBuffer(xml) },
        { path: "LINKLIST (renamed).XML", buffer: arrayBuffer(binary) },
      ],
      "renamed package",
    );

    expect(dataset.grids[0].decodedCellCount).toBe(48);
    expect(
      dataset.files.find((file) => file.filename.includes("GRD00001"))?.kind,
    ).toBe("taskdata");
    expect(
      dataset.files.find((file) => file.filename.includes("LINKLIST"))?.used,
    ).toBe(true);
  });

  it("keeps repeated package paths and parsed identities independently addressable", async () => {
    const firstPackage = await fixtureFiles();
    const secondPackage = await fixtureFiles();
    const dataset = await buildDataset(
      [...firstPackage, ...secondPackage],
      "combined workspace",
    );

    expect(dataset.files).toHaveLength(4);
    expect(new Set(dataset.files.map((file) => file.storageKey)).size).toBe(4);
    expect(Object.keys(dataset.rawBytesByFile)).toHaveLength(4);
    expect(Object.keys(dataset.rawXmlByFile)).toHaveLength(2);
    expect(new Set(dataset.tasks.map((task) => task.instanceId)).size).toBe(2);
    expect(new Set(dataset.grids.map((grid) => grid.instanceId)).size).toBe(2);
    expect(new Set(dataset.objects.map((object) => object.uid)).size).toBe(
      dataset.objects.length,
    );
  });

  it("maintains grid binary length invariants for random dimensions and PDV counts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000 }),
        fc.integer({ min: 1, max: 32 }),
        (cellCount, pdvCount) => {
          const bytesPerCell = pdvCount * 4;
          const total = cellCount * bytesPerCell;
          expect(total % bytesPerCell).toBe(0);
          expect(total / bytesPerCell).toBe(cellCount);
        },
      ),
    );
  });

  it("preflights Type 2 PDV removal and DET references", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const grid = dataset.grids[0];
    const detAssignments = Object.fromEntries(
      grid.channels.map((channel) => [
        channel.channelId,
        channel.deviceElementId ?? "",
      ]),
    );
    const analysis = analyzePackageTransform(dataset, {
      mode: "cleanup",
      variantName: "Two PDVs",
      keptTaskIds: dataset.tasks.map((task) => task.id),
      keptGridIds: dataset.grids.map((item) => item.id),
      keptChannelIds: grid.channels
        .slice(0, 2)
        .map((channel) => channel.channelId),
      detAssignments,
      newDeviceElements: [],
    });

    expect(analysis.blockers).toEqual([]);
    expect(analysis.changes).toContain(
      "Rebuild GRD00001.BIN with 2 of 3 PDVs.",
    );

    const invalidDet = analyzePackageTransform(dataset, {
      mode: "cleanup",
      variantName: "Invalid DET",
      keptTaskIds: dataset.tasks.map((task) => task.id),
      keptGridIds: dataset.grids.map((item) => item.id),
      keptChannelIds: grid.channels.map((channel) => channel.channelId),
      detAssignments: {
        ...detAssignments,
        [grid.channels[0].channelId]: "DET404",
      },
      newDeviceElements: [],
    });
    expect(
      invalidDet.blockers.some((message) => message.includes("DET404")),
    ).toBe(true);

    const newDet = analyzePackageTransform(dataset, {
      mode: "cleanup",
      variantName: "New DET",
      keptTaskIds: dataset.tasks.map((task) => task.id),
      keptGridIds: dataset.grids.map((item) => item.id),
      keptChannelIds: grid.channels.map((channel) => channel.channelId),
      detAssignments: {
        ...detAssignments,
        [grid.channels[0].channelId]: "DET4",
      },
      newDeviceElements: [
        {
          id: "DET4",
          deviceId: "DVC1",
          objectId: 4,
          elementType: 3,
          designator: "Rear tank",
          elementNumber: 4,
          parentObjectId: 0,
        },
      ],
    });
    expect(newDet.blockers).toEqual([]);
    expect(newDet.changes).toContain("Add DET4 (Rear tank) to DVC1.");
  });

  it("blocks variants when duplicate package evidence cannot be represented", async () => {
    const dataset = await buildDataset(await fixtureFiles(), "test fixture");
    const duplicateIssue: ValidationIssue = {
      id: "duplicate-package-path",
      severity: "warning",
      category: "package",
      code: "PACKAGE_DUPLICATE_FILE",
      message: "TASKDATA.XML occurs 2 times",
      explanation: "Every occurrence is preserved.",
      relatedObjects: [],
      suggestedAction: "Resolve the duplicate.",
      recovered: true,
      resultsMayBeIncomplete: false,
    };
    const grid = dataset.grids[0];
    const analysis = analyzePackageTransform(
      { ...dataset, issues: [...dataset.issues, duplicateIssue] },
      {
        mode: "cleanup",
        variantName: "Unsafe copy",
        keptTaskIds: dataset.tasks.map((task) => task.id),
        keptGridIds: dataset.grids.map((item) => item.id),
        keptChannelIds: grid.channels.map((channel) => channel.channelId),
        detAssignments: Object.fromEntries(
          grid.channels.map((channel) => [
            channel.channelId,
            channel.deviceElementId ?? "",
          ]),
        ),
        newDeviceElements: [],
      },
    );

    expect(analysis.blockers[0]).toMatch(/duplicate package paths/i);
  });

  it("allows only same-field, geometry-compatible task merges", async () => {
    const dataset = withCompatibleSecondTask(
      await buildDataset(await fixtureFiles(), "test fixture"),
    );
    const compatible = analyzePackageTransform(dataset, {
      mode: "merge",
      variantName: "Combined task",
      mergeTaskIds: ["TSK1", "TSK2"],
      mergedTaskName: "Combined North 40",
    });

    expect(compatible.blockers).toEqual([]);
    expect(
      compatible.changes.some((message) => message.includes("Merge 2 tasks")),
    ).toBe(true);

    dataset.tasks[1].fieldId = "PFD2";
    const differentField = analyzePackageTransform(dataset, {
      mode: "merge",
      variantName: "Invalid merge",
      mergeTaskIds: ["TSK1", "TSK2"],
      mergedTaskName: "Invalid merge",
    });
    expect(
      differentField.blockers.some((message) =>
        message.includes("share one resolved field"),
      ),
    ).toBe(true);
  });
});
