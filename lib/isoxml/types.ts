export type IsoXmlId = string;

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCategory =
  | "package"
  | "xml"
  | "reference"
  | "spatial"
  | "grid"
  | "timelog"
  | "semantic"
  | "support";

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  code: string;
  message: string;
  explanation: string;
  filename?: string;
  objectId?: string;
  objectType?: string;
  path?: string;
  byteOffset?: number;
  relatedObjects: string[];
  suggestedAction: string;
  recovered: boolean;
  resultsMayBeIncomplete: boolean;
}

export interface SourceLocation {
  line?: number;
  column?: number;
  byteStart?: number;
  byteEnd?: number;
}

export interface IsoXmlObject {
  uid: string;
  id?: IsoXmlId;
  elementType: string;
  attributes: Record<string, string>;
  children: IsoXmlObject[];
  sourceFile: string;
  sourceFileKey: string;
  path: string;
  text?: string;
  sourceLocation?: SourceLocation;
}

export interface FileManifestEntry {
  id: string;
  storageKey: string;
  path: string;
  filename: string;
  extension: string;
  kind:
    | "taskdata"
    | "xml"
    | "grid-binary"
    | "timelog-binary"
    | "archive"
    | "unknown";
  size: number;
  checksum: string;
  referencedBy: string[];
  referenceTarget?: string;
  parseStatus: "ready" | "parsed" | "unsupported" | "error";
  validationStatus: "valid" | "warning" | "error" | "unchecked";
  used: boolean;
  unresolved: boolean;
  previewHex: string;
}

export interface ValuePresentation {
  id: string;
  offset: string;
  scale: string;
  decimals: number;
  unit?: string;
  source: string;
  confidence: "declared" | "missing" | "invalid";
}

export interface GridChannel {
  channelId: string;
  pdvIndex: number;
  pdvObjectUid: string;
  ddi: number;
  ddiDisplay: string;
  ddiName: string;
  dictionarySource: string;
  productId?: string;
  productName?: string;
  productAllocationId?: string;
  deviceElementId?: string;
  deviceElementName?: string;
  valuePresentationId?: string;
  presentation: ValuePresentation;
  unit?: string;
  label: string;
}

export interface DecodedGrid {
  /** Stable identity for this parsed declaration, even when ISO IDs repeat. */
  instanceId: string;
  id: string;
  sourceObjectUid: string;
  taskInstanceId: string;
  taskId: string;
  name: string;
  filename: string;
  sourceBinaryKey?: string;
  gridType: number;
  rows: number;
  columns: number;
  origin: {
    latitude: number;
    longitude: number;
  };
  cellSize: {
    northSouth: number;
    eastWest: number;
  };
  cellSizeUnit: "degrees" | "meters";
  originCorner: "southwest" | "northwest";
  spatialStatus: "valid" | "invalid";
  channels: GridChannel[];
  treatmentZoneCodes: Uint16Array;
  rawValues: Int32Array[];
  decodedCellCount: number;
  expectedCellCount: number;
  bytesPerCell: number;
  binaryLength: number;
  declaredBinaryLength?: number;
  validationIssues: ValidationIssue[];
}

export interface TimeLogChannel {
  channelId: string;
  dlvIndex: number;
  ddi: number;
  ddiDisplay: string;
  ddiName: string;
  dictionarySource: string;
  deviceElementId?: string;
  deviceElementName?: string;
  deviceId?: string;
  deviceName?: string;
  processDataObjectId?: string;
  valuePresentationId?: string;
  presentation: ValuePresentation;
  unit?: string;
  label: string;
}

export type TimeLogAdapterSelectionMode = "automatic" | "manual" | "unresolved";

export interface TimeLogAdapterCandidate {
  id: string;
  label: string;
  description: string;
  score: number;
  compatible: boolean;
  autoSelectable: boolean;
  reason: string;
}

export interface TimeLogAdapterSelection {
  adapterId?: string;
  adapterLabel?: string;
  mode: TimeLogAdapterSelectionMode;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
  candidates: TimeLogAdapterCandidate[];
}

export interface DecodedTimeLog {
  instanceId: string;
  sourceObjectUid: string;
  taskInstanceId: string;
  taskId: string;
  id: string;
  filename: string;
  headerFilename: string;
  sourceBinaryKey?: string;
  sourceHeaderKey?: string;
  timeLogType: number;
  adapterSelection: TimeLogAdapterSelection;
  channels: TimeLogChannel[];
  timestamps: Float64Array;
  latitudes: Float64Array;
  longitudes: Float64Array;
  positionStatus: Uint8Array;
  validPositions: Uint8Array;
  rawValues: Int32Array[];
  valuePresent: Uint8Array[];
  recordByteOffsets: Uint32Array;
  decodedRecordCount: number;
  validPositionCount: number;
  binaryLength: number;
  decodedByteLength: number;
  bbox?: [west: number, south: number, east: number, north: number];
  validationIssues: ValidationIssue[];
}

export interface TaskSummary {
  /** Stable identity for this parsed declaration, even when ISO IDs repeat. */
  instanceId: string;
  id: string;
  objectUid: string;
  name: string;
  status: string;
  customerId?: string;
  customerName?: string;
  farmId?: string;
  farmName?: string;
  fieldId?: string;
  fieldName?: string;
  workerId?: string;
  workerName?: string;
  gridIds: string[];
  timeLogIds: string[];
  productIds: string[];
  ddiCount: number;
  issueCount: number;
}

export interface SpatialBoundary {
  id: string;
  name: string;
  taskId?: string;
  coordinates: Array<[number, number]>;
  sourceObjectUid: string;
}

export interface IsoXmlDataset {
  id: string;
  title: string;
  sourceLabel: string;
  importedAt: string;
  versionMajor?: string;
  versionMinor?: string;
  files: FileManifestEntry[];
  objects: IsoXmlObject[];
  tasks: TaskSummary[];
  grids: DecodedGrid[];
  timeLogs: DecodedTimeLog[];
  boundaries: SpatialBoundary[];
  issues: ValidationIssue[];
  rawXmlByFile: Record<string, string>;
  rawBytesByFile: Record<string, Uint8Array>;
  memoryBytes: number;
  supportSummary: {
    xmlWellFormed: "valid" | "invalid";
    structural: "valid" | "warning" | "invalid";
    schema: "not-checked" | "valid" | "invalid";
    references: "valid" | "warning" | "invalid";
    binary: "valid" | "warning" | "invalid";
    viewer: "partial" | "supported";
    roundTrip: "preserved-in-memory" | "not-preserved";
  };
}

export interface WorkerInputFile {
  path: string;
  buffer: ArrayBuffer;
}

export type ImportStage =
  | "reading"
  | "extracting"
  | "parsing"
  | "resolving"
  | "grids"
  | "timelogs"
  | "spatial"
  | "validating"
  | "ready";

export type WorkerRequest = {
  type: "import";
  requestId: string;
  files: WorkerInputFile[];
  sourceLabel: string;
};

export interface TimeLogAdapterWorkerRequest {
  type: "redecode-timelog";
  requestId: string;
  dataset: IsoXmlDataset;
  timeLogInstanceId: string;
  adapterId?: string;
}

export type WorkerResponse =
  | {
      type: "progress";
      requestId: string;
      stage: ImportStage;
      progress: number;
      detail: string;
    }
  | {
      type: "complete";
      requestId: string;
      dataset: IsoXmlDataset;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
