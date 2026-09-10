import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackageTransform } from "@/lib/isoxml/package-transform";
import { buildDataset } from "@/lib/isoxml/pipeline";
import { redecodeDatasetTimeLog } from "@/lib/isoxml/timelog-adapters";
import {
  timeLogChannelGeoJson,
  timeLogChannelShapefileZip,
} from "@/lib/isoxml/export";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function text(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

function timeLogBinary(): Uint8Array {
  const bytes = new Uint8Array(21);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, 3_000, true);
  offset += 4;
  view.setUint16(offset, 15_000, true);
  offset += 2;
  view.setInt32(offset, 555_000_000, true);
  offset += 4;
  view.setInt32(offset, 102_500_000, true);
  offset += 4;
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0);
  view.setInt32(offset, 42, true);
  return bytes;
}

describe("time-log package pipeline", () => {
  it("pairs, decodes and indexes executed Type 1 files", async () => {
    const taskData = `<?xml version="1.0" encoding="UTF-8"?>
      <ISO11783_TaskData VersionMajor="4" VersionMinor="3">
        <DVC A="DVC1" B="Machine">
          <DET A="DET1" D="Working element"><DOR A="300"/></DET>
          <DPD A="300" B="008D"/>
        </DVC>
        <TSK A="TSK1" B="Executed task" G="4">
          <TLG A="TLG00001" B="21" C="1"/>
        </TSK>
      </ISO11783_TaskData>`;
    const header = `<?xml version="1.0" encoding="UTF-8"?>
      <TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="008D" B="" C="DET1"/></TIM>`;
    const dataset = await buildDataset(
      [
        { path: "TASKDATA.XML", buffer: text(taskData) },
        { path: "TLG00001.XML", buffer: text(header) },
        { path: "TLG00001.BIN", buffer: arrayBuffer(timeLogBinary()) },
      ],
      "Synthetic executed task",
    );

    expect(dataset.timeLogs).toHaveLength(1);
    expect(dataset.timeLogs[0]).toMatchObject({
      id: "TLG00001",
      decodedRecordCount: 1,
      validPositionCount: 1,
      binaryLength: 21,
      adapterSelection: {
        adapterId: "native-isoxml-type-1",
        mode: "automatic",
        confidence: "high",
      },
    });
    expect(dataset.timeLogs[0].channels[0]).toMatchObject({
      ddi: 0x008d,
      ddiDisplay: "008D",
      deviceElementName: "Working element",
    });
    expect(dataset.tasks[0].timeLogIds).toEqual(["TLG00001"]);
    expect(
      dataset.issues.some(
        (entry) => entry.code === "TIMELOG_DECODER_ADAPTER_REQUIRED",
      ),
    ).toBe(false);
    expect(
      dataset.files
        .filter((file) => file.filename.startsWith("TLG"))
        .map((file) => [file.filename, file.used, file.unresolved]),
    ).toEqual([
      ["TLG00001.XML", true, false],
      ["TLG00001.BIN", true, false],
    ]);

    const removalPlan = {
      mode: "cleanup" as const,
      variantName: "Executed log removed",
      keptTaskIds: ["TSK1"],
      keptGridIds: [],
      keptChannelIds: [],
      keptTimeLogIds: [],
      detAssignments: {
        [dataset.timeLogs[0].channels[0].channelId]: "DET1",
      },
      newDeviceElements: [],
    };
    const unacknowledged = analyzePackageTransform(dataset, removalPlan);
    expect(
      unacknowledged.blockers.some((message) =>
        message.includes("Acknowledge the executed-data warning"),
      ),
    ).toBe(true);

    const accepted = analyzePackageTransform(dataset, {
      ...removalPlan,
      acknowledgeExecutedDataRisk: true,
    });
    expect(accepted.blockers).toEqual([]);
    expect(accepted.changes[0]).toContain("Delete executed log TLG00001");
    expect(accepted.warnings[0]).toContain("HIGH RISK");

    const geoJson = JSON.parse(
      timeLogChannelGeoJson(dataset, dataset.timeLogs[0], dataset.timeLogs[0].channels[0]),
    );
    const shapefileZip = await JSZip.loadAsync(
      await (
        await timeLogChannelShapefileZip(
          dataset,
          dataset.timeLogs[0],
          dataset.timeLogs[0].channels[0],
        )
      ).arrayBuffer(),
    );

    expect(geoJson.type).toBe("FeatureCollection");
    expect(geoJson.features).toHaveLength(1);
    expect(geoJson.features[0].geometry.type).toBe("Point");
    expect(geoJson.features[0].properties.scaledValue).toBe(42);
    expect(
      Object.keys(shapefileZip.files).some((path) => path.endsWith(".shp")),
    ).toBe(true);
    expect(
      Object.keys(shapefileZip.files).some((path) => path.endsWith(".shx")),
    ).toBe(true);
    expect(
      Object.keys(shapefileZip.files).some((path) => path.endsWith(".dbf")),
    ).toBe(true);
  });

  it("retains an uncertain log until a manual adapter re-decodes it", async () => {
    const taskData = `<?xml version="1.0" encoding="UTF-8"?>
      <ISO11783_TaskData VersionMajor="4" VersionMinor="3">
        <DVC A="DVC1" B="Machine">
          <DET A="DET1" D="Working element"><DOR A="300"/></DET>
          <DPD A="300" B="008D"/>
        </DVC>
        <TSK A="TSK1" B="Executed task" G="4">
          <TLG A="TLG00001" B="21" C="2"/>
        </TSK>
      </ISO11783_TaskData>`;
    const header = `<?xml version="1.0" encoding="UTF-8"?>
      <TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="008D" B="" C="DET1"/></TIM>`;
    const dataset = await buildDataset(
      [
        { path: "TASKDATA.XML", buffer: text(taskData) },
        { path: "TLG00001.XML", buffer: text(header) },
        { path: "TLG00001.BIN", buffer: arrayBuffer(timeLogBinary()) },
      ],
      "Synthetic uncertain time log",
    );

    expect(dataset.timeLogs[0].adapterSelection.mode).toBe("unresolved");
    expect(dataset.timeLogs[0].decodedRecordCount).toBe(0);

    const updated = redecodeDatasetTimeLog(
      dataset,
      dataset.timeLogs[0].instanceId,
      "native-ptn-type-1-compatibility",
    );

    expect(updated.timeLogs[0].adapterSelection.mode).toBe("manual");
    expect(updated.timeLogs[0].decodedRecordCount).toBe(1);
    expect(
      updated.issues.some((entry) => entry.code === "TIMELOG_ADAPTER_OVERRIDE"),
    ).toBe(true);
  });
});
