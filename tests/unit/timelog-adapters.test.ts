import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/lib/isoxml/reference-resolver";
import {
  decodeTimeLogWithAdapters,
  probeTimeLogAdapters,
  type TimeLogAdapterContext,
} from "@/lib/isoxml/timelog-adapters";
import { findObjects, parseLosslessXml } from "@/lib/isoxml/xml-parser";

function binaryRecord(): Uint8Array {
  const bytes = new Uint8Array(21);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, 1_000, true);
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

function context(declaredType: number): TimeLogAdapterContext {
  const taskRoots = parseLosslessXml(
    `<ISO11783_TaskData VersionMajor="4">
      <DVC A="DVC1"><DET A="DET1"><DOR A="10"/></DET><DPD A="10" B="008D"/></DVC>
      <TSK A="TSK1"><TLG A="TLG00001" C="${declaredType}"/></TSK>
    </ISO11783_TaskData>`,
    "TASKDATA.XML",
  );
  const headerRoots = parseLosslessXml(
    `<TIM A="" D="4"><PTN A="" B="" D=""/><DLV A="008D" B="" C="DET1"/></TIM>`,
    "TLG00001.XML",
  );
  const roots = [...taskRoots, ...headerRoots];
  return {
    timeLogObject: findObjects(taskRoots, "TLG")[0],
    taskObject: findObjects(taskRoots, "TSK")[0],
    header: findObjects(headerRoots, "TIM")[0],
    registry: buildRegistry(roots).registry,
    binary: binaryRecord(),
    identity: {
      timeLogInstanceId: "timelog-1",
      taskInstanceId: "task-1",
      filename: "TLG00001.BIN",
      headerFilename: "TLG00001.XML",
    },
  };
}

describe("native time-log adapter registry", () => {
  it("scores every registered adapter and automatically picks the strict match", () => {
    const adapterContext = context(1);
    const candidates = probeTimeLogAdapters(adapterContext);
    const decoded = decodeTimeLogWithAdapters(adapterContext);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      id: "native-isoxml-type-1",
      score: 100,
      compatible: true,
      autoSelectable: true,
    });
    expect(decoded.adapterSelection).toMatchObject({
      adapterId: "native-isoxml-type-1",
      mode: "automatic",
      confidence: "high",
    });
    expect(decoded.decodedRecordCount).toBe(1);
  });

  it("pauses on a conflicting declaration and permits an explicit compatibility choice", () => {
    const adapterContext = context(2);
    const automatic = decodeTimeLogWithAdapters(adapterContext);
    const manual = decodeTimeLogWithAdapters(
      adapterContext,
      "native-ptn-type-1-compatibility",
    );

    expect(automatic.adapterSelection.mode).toBe("unresolved");
    expect(automatic.decodedRecordCount).toBe(0);
    expect(
      automatic.adapterSelection.candidates.find(
        (candidate) => candidate.id === "native-ptn-type-1-compatibility",
      ),
    ).toMatchObject({ compatible: true, autoSelectable: false });
    expect(manual.adapterSelection).toMatchObject({
      adapterId: "native-ptn-type-1-compatibility",
      mode: "manual",
    });
    expect(manual.decodedRecordCount).toBe(1);
    expect(
      manual.validationIssues.some(
        (entry) => entry.code === "TIMELOG_ADAPTER_OVERRIDE",
      ),
    ).toBe(true);
  });
});
