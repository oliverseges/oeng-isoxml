import { buildRegistry, type ObjectRegistry } from "./reference-resolver";
import { decodeTimeLog, type TimeLogDecodeIdentity } from "./timelog-decoder";
import type {
  DecodedTimeLog,
  IsoXmlDataset,
  IsoXmlObject,
  TimeLogAdapterCandidate,
  TimeLogAdapterSelection,
} from "./types";
import { getAttribute } from "./xml-parser";

const AUTOMATIC_SELECTION_THRESHOLD = 70;
const AUTOMATIC_SELECTION_MARGIN = 10;

export interface TimeLogAdapterContext {
  timeLogObject: IsoXmlObject;
  taskObject: IsoXmlObject;
  header?: IsoXmlObject;
  registry: ObjectRegistry;
  binary?: Uint8Array;
  identity: TimeLogDecodeIdentity;
}

export interface TimeLogDecoderAdapter {
  id: string;
  label: string;
  description: string;
  probe: (
    context: TimeLogAdapterContext,
  ) => Omit<TimeLogAdapterCandidate, "id" | "label" | "description">;
  decode: (context: TimeLogAdapterContext) => DecodedTimeLog;
}

function declaredTimeLogType(
  context: TimeLogAdapterContext,
): number | undefined {
  const declared = getAttribute(context.timeLogObject, ["C", "TimeLogType"]);
  if (declared === undefined || declared === "") return undefined;
  const value = Number(declared);
  return Number.isFinite(value) ? value : undefined;
}

function hasPositionTemplate(context: TimeLogAdapterContext): boolean {
  return Boolean(
    context.header?.children.some((child) => child.elementType === "PTN"),
  );
}

function dataValueCount(context: TimeLogAdapterContext): number {
  return (
    context.header?.children.filter((child) => child.elementType === "DLV")
      .length ?? 0
  );
}

const nativeTypeOneAdapter: TimeLogDecoderAdapter = {
  id: "native-isoxml-type-1",
  label: "Native ISOXML Type 1",
  description:
    "Strict ISOXML Type 1 decoder using the companion PTN and ordered DLV declarations.",
  probe: (context) => {
    const declaredType = declaredTimeLogType(context);
    const declarationMatches = declaredType === undefined || declaredType === 1;
    let score = declaredType === 1 ? 75 : declaredType === undefined ? 60 : 0;
    if (context.header) score += 10;
    if (context.binary) score += 10;
    if (hasPositionTemplate(context)) score += 3;
    if (dataValueCount(context)) score += 2;
    return {
      score: Math.min(100, score),
      compatible: declarationMatches,
      autoSelectable: declarationMatches,
      reason: declarationMatches
        ? declaredType === 1
          ? "The TLG declaration identifies Type 1; the companion template and binary increase confidence when present."
          : "No conflicting type is declared and the companion structure matches the native Type 1 decoder."
        : `The TLG declaration identifies Type ${declaredType}, so the strict Type 1 adapter will not override it.`,
    };
  },
  decode: (context) =>
    decodeTimeLog(
      context.timeLogObject,
      context.taskObject,
      context.header,
      context.registry,
      context.binary,
      context.identity,
    ),
};

const nativePtnCompatibilityAdapter: TimeLogDecoderAdapter = {
  id: "native-ptn-type-1-compatibility",
  label: "Native PTN Type 1 compatibility",
  description:
    "Manual compatibility decoder for Type 1-shaped PTN/DLV records whose TLG declaration is missing or conflicts.",
  probe: (context) => {
    const declaredType = declaredTimeLogType(context);
    const hasHeader = Boolean(context.header);
    const hasBinary = Boolean(context.binary);
    const hasPtn = hasPositionTemplate(context);
    const compatible = hasHeader && hasBinary && hasPtn;
    const score = compatible
      ? declaredType !== undefined && declaredType !== 1
        ? 65
        : 55
      : 0;
    const missing = [
      !hasHeader ? "companion XML" : undefined,
      !hasBinary ? "binary file" : undefined,
      !hasPtn ? "PTN template" : undefined,
    ].filter((value): value is string => Boolean(value));
    return {
      score,
      compatible,
      autoSelectable: false,
      reason: compatible
        ? declaredType !== undefined && declaredType !== 1
          ? `The PTN/DLV structure can be interpreted as Type 1, but the source declares Type ${declaredType}; explicit user confirmation is required.`
          : "The PTN/DLV structure is compatible, but this permissive adapter is reserved for an explicit user choice."
        : `The compatibility decoder requires ${missing.join(", ")}.`,
    };
  },
  decode: (context) =>
    decodeTimeLog(
      context.timeLogObject,
      context.taskObject,
      context.header,
      context.registry,
      context.binary,
      context.identity,
      { layoutTypeOverride: 1 },
    ),
};

export const timeLogDecoderAdapters: readonly TimeLogDecoderAdapter[] = [
  nativeTypeOneAdapter,
  nativePtnCompatibilityAdapter,
];

export function probeTimeLogAdapters(
  context: TimeLogAdapterContext,
): TimeLogAdapterCandidate[] {
  return timeLogDecoderAdapters
    .map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      description: adapter.description,
      ...adapter.probe(context),
    }))
    .sort((left, right) => right.score - left.score);
}

function confidenceFor(score: number): TimeLogAdapterSelection["confidence"] {
  if (score >= 90) return "high";
  if (score >= AUTOMATIC_SELECTION_THRESHOLD) return "medium";
  if (score > 0) return "low";
  return "none";
}

function withSelection(
  decoded: DecodedTimeLog,
  selection: TimeLogAdapterSelection,
): DecodedTimeLog {
  return { ...decoded, adapterSelection: selection };
}

export function decodeTimeLogWithAdapters(
  context: TimeLogAdapterContext,
  requestedAdapterId?: string,
): DecodedTimeLog {
  const candidates = probeTimeLogAdapters(context);

  if (requestedAdapterId) {
    const adapter = timeLogDecoderAdapters.find(
      (candidate) => candidate.id === requestedAdapterId,
    );
    const candidate = candidates.find(
      (entry) => entry.id === requestedAdapterId,
    );
    if (!adapter || !candidate) {
      throw new Error(`Unknown time-log adapter ${requestedAdapterId}.`);
    }
    if (!candidate.compatible) {
      throw new Error(`${adapter.label} cannot decode this time log.`);
    }
    return withSelection(adapter.decode(context), {
      adapterId: adapter.id,
      adapterLabel: adapter.label,
      mode: "manual",
      confidence: confidenceFor(candidate.score),
      reason: `Selected manually. ${candidate.reason}`,
      candidates,
    });
  }

  const automaticCandidates = candidates.filter(
    (candidate) =>
      candidate.compatible &&
      candidate.autoSelectable &&
      candidate.score >= AUTOMATIC_SELECTION_THRESHOLD,
  );
  const first = automaticCandidates[0];
  const second = automaticCandidates[1];
  const uniqueEnough =
    first &&
    (!second || first.score - second.score >= AUTOMATIC_SELECTION_MARGIN);
  if (first && uniqueEnough) {
    const adapter = timeLogDecoderAdapters.find(
      (candidate) => candidate.id === first.id,
    ) as TimeLogDecoderAdapter;
    return withSelection(adapter.decode(context), {
      adapterId: adapter.id,
      adapterLabel: adapter.label,
      mode: "automatic",
      confidence: confidenceFor(first.score),
      reason: `Selected automatically with compatibility score ${first.score}/100. ${first.reason}`,
      candidates,
    });
  }

  const preserved = nativeTypeOneAdapter.decode(context);
  const compatibleManual = candidates.filter(
    (candidate) => candidate.compatible && !candidate.autoSelectable,
  );
  return withSelection(preserved, {
    mode: "unresolved",
    confidence: "none",
    reason: compatibleManual.length
      ? `Automatic selection paused because no unique adapter reached ${AUTOMATIC_SELECTION_THRESHOLD}/100. Choose a compatible adapter to decode without changing the source.`
      : "No registered adapter can decode the available declaration, companion template, and binary. The source remains preserved.",
    candidates,
  });
}

function rootObjects(objects: IsoXmlObject[]): IsoXmlObject[] {
  const childUids = new Set(
    objects.flatMap((object) => object.children.map((child) => child.uid)),
  );
  const roots = objects.filter((object) => !childUids.has(object.uid));
  return roots.length ? roots : objects;
}

function decodedArrayBytes(timeLog: DecodedTimeLog): number {
  return (
    timeLog.timestamps.byteLength +
    timeLog.latitudes.byteLength +
    timeLog.longitudes.byteLength +
    timeLog.positionStatus.byteLength +
    timeLog.validPositions.byteLength +
    timeLog.recordByteOffsets.byteLength +
    timeLog.rawValues.reduce((sum, values) => sum + values.byteLength, 0) +
    timeLog.valuePresent.reduce((sum, values) => sum + values.byteLength, 0)
  );
}

export function redecodeDatasetTimeLog(
  dataset: IsoXmlDataset,
  timeLogInstanceId: string,
  requestedAdapterId?: string,
): IsoXmlDataset {
  const previous = dataset.timeLogs.find(
    (timeLog) => timeLog.instanceId === timeLogInstanceId,
  );
  if (!previous) throw new Error("The selected time log no longer exists.");
  const timeLogObject = dataset.objects.find(
    (object) => object.uid === previous.sourceObjectUid,
  );
  const task = dataset.tasks.find(
    (candidate) => candidate.instanceId === previous.taskInstanceId,
  );
  const taskObject = dataset.objects.find(
    (object) => object.uid === task?.objectUid,
  );
  if (!timeLogObject || !taskObject) {
    throw new Error("The time-log declaration or owning task is unavailable.");
  }
  const header = previous.sourceHeaderKey
    ? dataset.objects.find(
        (object) =>
          object.elementType === "TIM" &&
          (object.sourceFileKey === previous.sourceHeaderKey ||
            object.sourceFile === previous.sourceHeaderKey),
      )
    : undefined;
  const roots = rootObjects(dataset.objects);
  const registry = buildRegistry(roots).registry;
  const binary = previous.sourceBinaryKey
    ? dataset.rawBytesByFile[previous.sourceBinaryKey]
    : undefined;
  const decoded = decodeTimeLogWithAdapters(
    {
      timeLogObject,
      taskObject,
      header,
      registry,
      binary,
      identity: {
        timeLogInstanceId: previous.instanceId,
        taskInstanceId: previous.taskInstanceId,
        sourceBinaryKey: previous.sourceBinaryKey,
        sourceHeaderKey: previous.sourceHeaderKey,
        filename: previous.filename,
        headerFilename: previous.headerFilename,
      },
    },
    requestedAdapterId,
  );
  const previousIssueIds = new Set(
    previous.validationIssues.map((entry) => entry.id),
  );
  const issues = [
    ...dataset.issues.filter((entry) => !previousIssueIds.has(entry.id)),
    ...decoded.validationIssues,
  ];
  const timeLogs = dataset.timeLogs.map((timeLog) =>
    timeLog.instanceId === timeLogInstanceId ? decoded : timeLog,
  );
  const hasErrors = issues.some((entry) => entry.severity === "error");
  const hasWarnings = issues.some((entry) => entry.severity === "warning");
  const binaryIssues = issues.filter(
    (entry) => entry.category === "grid" || entry.category === "timelog",
  );
  const tasks = dataset.tasks.map((candidate) => ({
    ...candidate,
    issueCount: issues.filter(
      (entry) =>
        entry.severity !== "info" &&
        (entry.objectId === candidate.id ||
          dataset.grids.some(
            (grid) =>
              grid.taskInstanceId === candidate.instanceId &&
              entry.objectId === grid.id,
          ) ||
          timeLogs.some(
            (timeLog) =>
              timeLog.taskInstanceId === candidate.instanceId &&
              entry.objectId === timeLog.id,
          )),
    ).length,
  }));
  return {
    ...dataset,
    tasks,
    timeLogs,
    issues,
    memoryBytes:
      dataset.memoryBytes -
      decodedArrayBytes(previous) +
      decodedArrayBytes(decoded),
    files: dataset.files.map((file) => ({
      ...file,
      validationStatus: issues.some(
        (entry) => entry.filename === file.path && entry.severity === "error",
      )
        ? ("error" as const)
        : issues.some(
              (entry) =>
                entry.filename === file.path && entry.severity === "warning",
            )
          ? ("warning" as const)
          : ("valid" as const),
    })),
    supportSummary: {
      ...dataset.supportSummary,
      structural: hasErrors ? "invalid" : hasWarnings ? "warning" : "valid",
      binary: binaryIssues.some((entry) => entry.severity === "error")
        ? "invalid"
        : binaryIssues.some((entry) => entry.severity === "warning")
          ? "warning"
          : "valid",
    },
  };
}
