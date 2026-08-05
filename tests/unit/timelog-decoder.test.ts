import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/lib/isoxml/reference-resolver";
import { decodeTimeLog } from "@/lib/isoxml/timelog-decoder";
import { findObjects, parseLosslessXml } from "@/lib/isoxml/xml-parser";

function typeOneBinary(): Uint8Array {
  const bytes = new Uint8Array(42);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const record = (
    milliseconds: number,
    days: number,
    latitude: number,
    longitude: number,
    status: number,
    rawValue: number,
  ) => {
    view.setUint32(offset, milliseconds, true);
    offset += 4;
    view.setUint16(offset, days, true);
    offset += 2;
    view.setInt32(offset, Math.round(latitude * 10_000_000), true);
    offset += 4;
    view.setInt32(offset, Math.round(longitude * 10_000_000), true);
    offset += 4;
    view.setUint8(offset++, status);
    view.setUint8(offset++, 1);
    view.setUint8(offset++, 0);
    view.setInt32(offset, rawValue, true);
    offset += 4;
  };
  record(1_000, 15_000, 55.5, 10.25, 4, 10);
  record(2_000, 15_000, 55.5001, 10.2502, 4, 20);
  return bytes;
}

function fixture() {
  const taskRoots = parseLosslessXml(
    `<ISO11783_TaskData VersionMajor="4">
      <DVC A="DVC1" B="Sprayer">
        <DET A="DET1" D="Boom"><DOR A="10"/></DET>
        <DPD A="10" B="008D" F="20"/>
        <DVP A="20" B="0" C="0.1" D="1" E="%"/>
      </DVC>
      <TSK A="TSK1" B="Executed task"><TLG A="TLG00001" C="1"/></TSK>
    </ISO11783_TaskData>`,
    "TASKDATA.XML",
  );
  const headerRoots = parseLosslessXml(
    `<TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="008D" B="" C="DET1"/></TIM>`,
    "TLG00001.XML",
  );
  const roots = [...taskRoots, ...headerRoots];
  const registry = buildRegistry(roots).registry;
  return {
    registry,
    task: findObjects(taskRoots, "TSK")[0],
    declaration: findObjects(taskRoots, "TLG")[0],
    header: findObjects(headerRoots, "TIM")[0],
  };
}

describe("ISOXML Type 1 time-log decoder", () => {
  it("decodes timestamps, positions, sparse DLV values and device presentation", () => {
    const { registry, task, declaration, header } = fixture();
    const decoded = decodeTimeLog(
      declaration,
      task,
      header,
      registry,
      typeOneBinary(),
      {
        timeLogInstanceId: "timelog-1",
        taskInstanceId: "task-1",
        sourceBinaryKey: "binary-key",
        sourceHeaderKey: "header-key",
        filename: "TLG00001.BIN",
        headerFilename: "TLG00001.XML",
      },
    );

    expect(decoded.decodedRecordCount).toBe(2);
    expect(decoded.validPositionCount).toBe(2);
    expect(decoded.decodedByteLength).toBe(typeOneBinary().byteLength);
    expect(decoded.bbox).toEqual([10.25, 55.5, 10.2502, 55.5001]);
    expect(new Date(decoded.timestamps[0]).toISOString()).toBe(
      "2021-01-25T00:00:01.000Z",
    );
    expect(Array.from(decoded.rawValues[0])).toEqual([10, 20]);
    expect(Array.from(decoded.valuePresent[0])).toEqual([1, 1]);
    expect(decoded.channels[0]).toMatchObject({
      ddi: 0x008d,
      ddiDisplay: "008D",
      deviceElementId: "DET1",
      deviceElementName: "Boom",
      deviceId: "DVC1",
      deviceName: "Sprayer",
      processDataObjectId: "10",
      unit: "%",
      presentation: {
        offset: "0",
        scale: "0.1",
        decimals: 1,
        confidence: "declared",
      },
    });
    expect(
      decoded.validationIssues.some((entry) => entry.severity === "error"),
    ).toBe(false);
  });

  it("keeps complete records and reports a truncated tail", () => {
    const { registry, task, declaration, header } = fixture();
    const binary = typeOneBinary().slice(0, -2);
    const decoded = decodeTimeLog(declaration, task, header, registry, binary, {
      timeLogInstanceId: "timelog-1",
      taskInstanceId: "task-1",
      filename: "TLG00001.BIN",
      headerFilename: "TLG00001.XML",
    });

    expect(decoded.decodedRecordCount).toBe(1);
    expect(decoded.rawValues[0]).toHaveLength(1);
    expect(
      decoded.validationIssues.some(
        (entry) => entry.code === "TIMELOG_BINARY_TRUNCATED",
      ),
    ).toBe(true);
  });
});
