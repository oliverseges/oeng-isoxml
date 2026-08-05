import { describeDdi, formatDdi, parseDdi } from "./ddi-service";
import {
  MAX_PRESENTATION_DECIMALS,
  MAX_TIMELOG_RECORD_COUNT,
  MAX_TIMELOG_VALUE_SLOTS,
} from "./limits";
import { issue } from "./object-model";
import type { ObjectRegistry } from "./reference-resolver";
import { resolveDeviceObject, resolveOne } from "./reference-resolver";
import type {
  DecodedTimeLog,
  IsoXmlObject,
  TimeLogChannel,
  ValidationIssue,
  ValuePresentation,
} from "./types";
import { getAttribute } from "./xml-parser";

const MILLISECONDS_1970_TO_1980 = Date.UTC(1980, 0, 1);
const positionAttributeOrder = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
] as const;

export interface TimeLogDecodeIdentity {
  timeLogInstanceId: string;
  taskInstanceId: string;
  sourceBinaryKey?: string;
  sourceHeaderKey?: string;
  filename: string;
  headerFilename: string;
}

export interface TimeLogDecodeOptions {
  layoutTypeOverride?: number;
}

class BinaryReadError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

class LittleEndianReader {
  private readonly view: DataView;
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  private require(byteCount: number): void {
    if (this.offset + byteCount > this.length) {
      throw new BinaryReadError(
        `The record ends at byte ${this.length}, before ${byteCount} required byte(s) at offset ${this.offset}.`,
        this.offset,
      );
    }
  }

  uint8(): number {
    this.require(1);
    return this.view.getUint8(this.offset++);
  }

  uint16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  uint32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  int32(): number {
    this.require(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
}

function owningDeviceName(
  registry: ObjectRegistry,
  deviceElement: IsoXmlObject | undefined,
): { deviceId?: string; deviceName?: string } {
  const device = deviceElement
    ? registry.ownerDeviceByObjectUid.get(deviceElement.uid)
    : undefined;
  return {
    deviceId: device?.id,
    deviceName: device
      ? getAttribute(device, ["B", "DeviceDesignator", "Designator"])
      : undefined,
  };
}

function processDataFor(
  registry: ObjectRegistry,
  deviceElement: IsoXmlObject | undefined,
  ddi: number,
): IsoXmlObject | undefined {
  if (!deviceElement) return undefined;
  const referencedIds = deviceElement.children
    .filter((child) => child.elementType === "DOR")
    .map((child) => getAttribute(child, ["A", "DeviceObjectIdRef"]))
    .filter((value): value is string => Boolean(value));
  const referenced = referencedIds
    .map((id) =>
      resolveDeviceObject(registry, deviceElement, id, ["DPD", "DPT"]),
    )
    .filter((object): object is IsoXmlObject => Boolean(object));
  const matchingReferenced = referenced.filter(
    (object) => parseDdi(getAttribute(object, ["B", "ProcessDataDDI"])) === ddi,
  );
  if (matchingReferenced.length === 1) return matchingReferenced[0];

  const ownerDevice = registry.ownerDeviceByObjectUid.get(deviceElement.uid);
  if (!ownerDevice) return undefined;
  const fallback = ownerDevice.children.filter(
    (object) =>
      (object.elementType === "DPD" || object.elementType === "DPT") &&
      parseDdi(getAttribute(object, ["B", "ProcessDataDDI"])) === ddi,
  );
  return fallback.length === 1 ? fallback[0] : undefined;
}

function presentationFor(
  registry: ObjectRegistry,
  processData: IsoXmlObject | undefined,
  issues: ValidationIssue[],
): ValuePresentation {
  const presentationId = processData
    ? getAttribute(
        processData,
        processData.elementType === "DPD"
          ? ["F", "DeviceValuePresentationObjectIdRef"]
          : ["E", "DeviceValuePresentationObjectIdRef"],
      )
    : undefined;
  const presentationObject = resolveDeviceObject(
    registry,
    processData,
    presentationId,
    ["DVP"],
  );
  if (!presentationObject) {
    return {
      id: presentationId ?? "missing",
      offset: "0",
      scale: "1",
      decimals: 0,
      source: "No device value presentation",
      confidence: "missing",
    };
  }

  const offset = getAttribute(presentationObject, ["B", "Offset"]) ?? "0";
  const scale = getAttribute(presentationObject, ["C", "Scale"]) ?? "1";
  const decimals = Number(
    getAttribute(presentationObject, ["D", "NumberOfDecimals"]) ?? "0",
  );
  const unit = getAttribute(presentationObject, ["E", "UnitDesignator"]);
  const valid =
    Number.isFinite(Number(offset)) &&
    Number.isFinite(Number(scale)) &&
    Number(scale) !== 0 &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= MAX_PRESENTATION_DECIMALS;
  if (!valid) {
    issues.push(
      issue({
        severity: "error",
        category: "semantic",
        code: "VALUE_PRESENTATION_INVALID",
        message: `Value presentation ${presentationObject.id ?? presentationObject.uid} is invalid`,
        explanation:
          "Time-log values remain available as raw signed 32-bit integers.",
        filename: presentationObject.sourceFile,
        objectId: presentationObject.id,
        objectType: presentationObject.elementType,
        path: presentationObject.path,
        suggestedAction:
          "Correct the declared offset, scale and decimal count in the device object pool.",
        recovered: true,
        resultsMayBeIncomplete: false,
      }),
    );
  }
  return {
    id: presentationObject.id ?? presentationObject.uid,
    offset,
    scale,
    decimals:
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= MAX_PRESENTATION_DECIMALS
        ? decimals
        : 0,
    unit,
    source: `DVP ${presentationObject.id ?? presentationObject.uid}`,
    confidence: valid ? "declared" : "invalid",
  };
}

function channelsFromHeader(
  header: IsoXmlObject | undefined,
  registry: ObjectRegistry,
  instanceId: string,
  issues: ValidationIssue[],
): TimeLogChannel[] {
  const declarations =
    header?.children.filter((child) => child.elementType === "DLV") ?? [];
  return declarations.map((declaration, dlvIndex) => {
    const ddi = parseDdi(
      getAttribute(declaration, ["A", "ProcessDataDDI", "DDI"]),
    );
    const ddiDisplay = formatDdi(ddi);
    const ddiInfo = describeDdi(ddi);
    const deviceElementId = getAttribute(declaration, [
      "C",
      "DeviceElementIdRef",
    ]);
    const deviceElement = resolveOne(registry, deviceElementId, ["DET"]);
    const processData = processDataFor(registry, deviceElement, ddi);
    const presentation = presentationFor(registry, processData, issues);
    const { deviceId, deviceName } = owningDeviceName(registry, deviceElement);
    const deviceElementName = deviceElement
      ? getAttribute(deviceElement, [
          "D",
          "DeviceElementDesignator",
          "Designator",
        ])
      : undefined;
    return {
      channelId: `${instanceId}:${dlvIndex}:${ddiDisplay}:${deviceElementId ?? "no-det"}`,
      dlvIndex,
      ddi,
      ddiDisplay,
      ddiName: ddiInfo.name,
      dictionarySource: ddiInfo.source,
      deviceElementId,
      deviceElementName,
      deviceId,
      deviceName,
      processDataObjectId: processData?.id,
      valuePresentationId: presentation.id,
      presentation,
      unit: presentation.unit,
      label: `DDI ${ddiDisplay} · ${ddiInfo.name} · ${deviceElementName ?? "Device element unresolved"}`,
    };
  });
}

function readPositionValue(
  reader: LittleEndianReader,
  attribute: (typeof positionAttributeOrder)[number],
): number {
  switch (attribute) {
    case "A":
    case "B":
    case "C":
      return reader.int32();
    case "D":
    case "G":
      return reader.uint8();
    case "E":
    case "F":
    case "I":
      return reader.uint16();
    case "H":
      return reader.uint32();
  }
}

export function decodeTimeLog(
  timeLogObject: IsoXmlObject,
  taskObject: IsoXmlObject,
  header: IsoXmlObject | undefined,
  registry: ObjectRegistry,
  binary: Uint8Array | undefined,
  identity: TimeLogDecodeIdentity,
  options: TimeLogDecodeOptions = {},
): DecodedTimeLog {
  const issues: ValidationIssue[] = [];
  const id =
    getAttribute(timeLogObject, ["A", "Filename"]) ?? timeLogObject.uid;
  const timeLogType = Number(
    getAttribute(timeLogObject, ["C", "TimeLogType"]) ?? "1",
  );
  const layoutType = options.layoutTypeOverride ?? timeLogType;
  const channels = channelsFromHeader(
    header,
    registry,
    identity.timeLogInstanceId,
    issues,
  );

  if (!header) {
    issues.push(
      issue({
        severity: "error",
        category: "timelog",
        code: "TIMELOG_HEADER_MISSING",
        message: `Time-log header ${identity.headerFilename} is missing`,
        explanation:
          "The companion TIM/PTN/DLV template is required to determine each binary record layout.",
        filename: identity.headerFilename,
        objectId: id,
        objectType: "TLG",
        path: timeLogObject.path,
        suggestedAction: "Import the matching time-log XML file.",
        recovered: false,
        resultsMayBeIncomplete: true,
      }),
    );
  }
  if (!binary) {
    issues.push(
      issue({
        severity: "error",
        category: "timelog",
        code: "TIMELOG_BINARY_MISSING",
        message: `Time-log binary ${identity.filename} is missing`,
        explanation:
          "The time-log declaration and header remain available, but executed records cannot be decoded.",
        filename: identity.filename,
        objectId: id,
        objectType: "TLG",
        path: timeLogObject.path,
        suggestedAction: "Import the matching time-log BIN file.",
        recovered: false,
        resultsMayBeIncomplete: true,
      }),
    );
  }
  if (layoutType !== 1) {
    issues.push(
      issue({
        severity: "warning",
        category: "support",
        code: "TIMELOG_TYPE_UNSUPPORTED",
        message: `Time-log type ${timeLogType} is preserved but not decoded`,
        explanation: "This viewer decodes ISOXML binary time-log file Type 1.",
        filename: identity.filename,
        objectId: id,
        objectType: "TLG",
        path: timeLogObject.path,
        suggestedAction: "Use a verified decoder for this time-log type.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }
  if (
    options.layoutTypeOverride !== undefined &&
    options.layoutTypeOverride !== timeLogType
  ) {
    issues.push(
      issue({
        severity: "warning",
        category: "timelog",
        code: "TIMELOG_ADAPTER_OVERRIDE",
        message: `${identity.filename} is being interpreted with a Type ${options.layoutTypeOverride} layout`,
        explanation: `The source declares time-log type ${timeLogType}. A user-selected compatibility adapter overrides that declaration for decoding without changing the preserved source.`,
        filename: identity.filename,
        objectId: id,
        objectType: "TLG",
        path: timeLogObject.path,
        suggestedAction:
          "Confirm the decoded positions and channel values against the source system before relying on them.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  const empty = (): DecodedTimeLog => ({
    instanceId: identity.timeLogInstanceId,
    sourceObjectUid: timeLogObject.uid,
    taskInstanceId: identity.taskInstanceId,
    taskId: taskObject.id ?? taskObject.uid,
    id,
    filename: identity.filename,
    headerFilename: identity.headerFilename,
    sourceBinaryKey: identity.sourceBinaryKey,
    sourceHeaderKey: identity.sourceHeaderKey,
    timeLogType,
    adapterSelection: {
      mode: "unresolved",
      confidence: "none",
      reason: "No decoder adapter selection has been recorded.",
      candidates: [],
    },
    channels,
    timestamps: new Float64Array(),
    latitudes: new Float64Array(),
    longitudes: new Float64Array(),
    positionStatus: new Uint8Array(),
    validPositions: new Uint8Array(),
    rawValues: channels.map(() => new Int32Array()),
    valuePresent: channels.map(() => new Uint8Array()),
    recordByteOffsets: new Uint32Array(),
    decodedRecordCount: 0,
    validPositionCount: 0,
    binaryLength: binary?.byteLength ?? 0,
    decodedByteLength: 0,
    validationIssues: issues,
  });
  if (!header || !binary || layoutType !== 1) return empty();

  const positionTemplate = header.children.find(
    (child) => child.elementType === "PTN",
  );
  const timestamps: number[] = [];
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  const positionStatuses: number[] = [];
  const validPositions: number[] = [];
  const recordByteOffsets: number[] = [];
  const rawValues = channels.map(() => [] as number[]);
  const valuePresent = channels.map(() => [] as number[]);
  const maximumRecords = Math.min(
    MAX_TIMELOG_RECORD_COUNT,
    Math.max(
      1,
      Math.floor(MAX_TIMELOG_VALUE_SLOTS / Math.max(1, channels.length)),
    ),
  );
  const reader = new LittleEndianReader(binary);
  let validPositionCount = 0;
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  while (reader.offset < reader.length && timestamps.length < maximumRecords) {
    const recordIndex = timestamps.length;
    recordByteOffsets.push(reader.offset);
    try {
      const millisecondsInDay = reader.uint32();
      const daysSince1980 = reader.uint16();
      timestamps.push(
        MILLISECONDS_1970_TO_1980 +
          daysSince1980 * 86_400_000 +
          millisecondsInDay,
      );

      const position: Record<string, number> = {};
      if (positionTemplate) {
        for (const attribute of positionAttributeOrder) {
          if (!(attribute in positionTemplate.attributes)) continue;
          const declared = positionTemplate.attributes[attribute];
          position[attribute] =
            declared === ""
              ? readPositionValue(reader, attribute)
              : Number(declared);
        }
      }
      const latitude =
        position.A === undefined
          ? Number.NaN
          : positionTemplate?.attributes.A === ""
            ? position.A / 10_000_000
            : position.A;
      const longitude =
        position.B === undefined
          ? Number.NaN
          : positionTemplate?.attributes.B === ""
            ? position.B / 10_000_000
            : position.B;
      const positionValid =
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180 &&
        (latitude !== 0 || longitude !== 0);
      latitudes.push(latitude);
      longitudes.push(longitude);
      positionStatuses.push(Number.isFinite(position.D) ? position.D : 0);
      validPositions.push(positionValid ? 1 : 0);
      if (positionValid) {
        validPositionCount += 1;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }

      rawValues.forEach((values) => values.push(0));
      valuePresent.forEach((values) => values.push(0));
      const valueCount = reader.uint8();
      for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
        const dlvIndex = reader.uint8();
        const rawValue = reader.int32();
        if (dlvIndex >= channels.length) {
          issues.push(
            issue({
              severity: "error",
              category: "timelog",
              code: "TIMELOG_DLV_INDEX_INVALID",
              message: `Record ${recordIndex + 1} references DLV index ${dlvIndex}, but only ${channels.length} declarations exist`,
              explanation:
                "The signed value was consumed to preserve record alignment, but it cannot be assigned to a channel.",
              filename: identity.filename,
              objectId: id,
              objectType: "TLG",
              path: timeLogObject.path,
              byteOffset: reader.offset - 5,
              suggestedAction:
                "Verify that the time-log XML header and BIN file are a matching pair.",
              recovered: true,
              resultsMayBeIncomplete: true,
            }),
          );
          continue;
        }
        rawValues[dlvIndex][recordIndex] = rawValue;
        valuePresent[dlvIndex][recordIndex] = 1;
      }
    } catch (error) {
      timestamps.length = recordIndex;
      latitudes.length = recordIndex;
      longitudes.length = recordIndex;
      positionStatuses.length = recordIndex;
      validPositions.length = recordIndex;
      recordByteOffsets.length = recordIndex;
      rawValues.forEach((values) => {
        values.length = recordIndex;
      });
      valuePresent.forEach((values) => {
        values.length = recordIndex;
      });
      issues.push(
        issue({
          severity: "error",
          category: "timelog",
          code: "TIMELOG_BINARY_TRUNCATED",
          message: `${identity.filename} ends inside record ${recordIndex + 1}`,
          explanation:
            error instanceof Error
              ? error.message
              : "The record is incomplete.",
          filename: identity.filename,
          objectId: id,
          objectType: "TLG",
          path: timeLogObject.path,
          byteOffset:
            error instanceof BinaryReadError ? error.offset : reader.offset,
          suggestedAction:
            "Verify that the time-log XML header and BIN file are complete and belong together.",
          recovered: recordIndex > 0,
          resultsMayBeIncomplete: true,
        }),
      );
      break;
    }
  }

  if (timestamps.length >= maximumRecords && reader.offset < reader.length) {
    issues.push(
      issue({
        severity: "error",
        category: "timelog",
        code: "TIMELOG_RECORD_LIMIT_EXCEEDED",
        message: `${identity.filename} exceeds the safe decoded-record limit`,
        explanation: `Decoding stopped after ${maximumRecords.toLocaleString()} records to keep the browser responsive. Raw bytes remain preserved.`,
        filename: identity.filename,
        objectId: id,
        objectType: "TLG",
        path: timeLogObject.path,
        byteOffset: reader.offset,
        suggestedAction: "Split the time log into smaller task-data packages.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  validPositionCount = 0;
  west = Number.POSITIVE_INFINITY;
  south = Number.POSITIVE_INFINITY;
  east = Number.NEGATIVE_INFINITY;
  north = Number.NEGATIVE_INFINITY;
  validPositions.forEach((isValid, index) => {
    if (!isValid) return;
    validPositionCount += 1;
    west = Math.min(west, longitudes[index]);
    south = Math.min(south, latitudes[index]);
    east = Math.max(east, longitudes[index]);
    north = Math.max(north, latitudes[index]);
  });

  return {
    instanceId: identity.timeLogInstanceId,
    sourceObjectUid: timeLogObject.uid,
    taskInstanceId: identity.taskInstanceId,
    taskId: taskObject.id ?? taskObject.uid,
    id,
    filename: identity.filename,
    headerFilename: identity.headerFilename,
    sourceBinaryKey: identity.sourceBinaryKey,
    sourceHeaderKey: identity.sourceHeaderKey,
    timeLogType,
    adapterSelection: {
      mode: "unresolved",
      confidence: "none",
      reason: "No decoder adapter selection has been recorded.",
      candidates: [],
    },
    channels,
    timestamps: Float64Array.from(timestamps),
    latitudes: Float64Array.from(latitudes),
    longitudes: Float64Array.from(longitudes),
    positionStatus: Uint8Array.from(positionStatuses),
    validPositions: Uint8Array.from(validPositions),
    rawValues: rawValues.map((values) => Int32Array.from(values)),
    valuePresent: valuePresent.map((values) => Uint8Array.from(values)),
    recordByteOffsets: Uint32Array.from(recordByteOffsets),
    decodedRecordCount: timestamps.length,
    validPositionCount,
    binaryLength: binary.byteLength,
    decodedByteLength: reader.offset,
    bbox: validPositionCount ? [west, south, east, north] : undefined,
    validationIssues: issues,
  };
}
