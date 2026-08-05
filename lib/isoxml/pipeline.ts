import {
  basename,
  classifyFile,
  expandInputFiles,
  findPackageFile,
  hexPreview,
  sha256,
} from "./file-loader";
import { decodeGrid } from "./grid-decoder";
import { flattenObjects, issue } from "./object-model";
import { buildRegistry, resolveOne } from "./reference-resolver";
import { decodeTimeLogWithAdapters } from "./timelog-adapters";
import type {
  DecodedGrid,
  DecodedTimeLog,
  FileManifestEntry,
  ImportStage,
  IsoXmlDataset,
  IsoXmlObject,
  SpatialBoundary,
  TaskSummary,
  ValidationIssue,
  WorkerInputFile,
} from "./types";
import { findObjects, getAttribute, parseLosslessXml } from "./xml-parser";

const knownElements = new Set([
  "ISO11783_TASKDATA",
  "AFE",
  "BSN",
  "CCT",
  "CCG",
  "CPC",
  "CTR",
  "DLT",
  "DVC",
  "DET",
  "DPD",
  "DPT",
  "DVP",
  "DOR",
  "FRM",
  "GRD",
  "GGP",
  "GPN",
  "LSG",
  "OTQ",
  "OTP",
  "PAN",
  "PFD",
  "PDT",
  "PGP",
  "PLN",
  "PNT",
  "PDV",
  "PPN",
  "ASP",
  "TLG",
  "TIM",
  "TSK",
  "TZN",
  "VPN",
  "WKR",
]);

function stage(
  callback:
    | ((stage: ImportStage, progress: number, detail: string) => void)
    | undefined,
  name: ImportStage,
  progress: number,
  detail: string,
) {
  callback?.(name, progress, detail);
}

function textDecoder(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function titleFrom(
  sourceLabel: string,
  tasks: TaskSummary[],
  taskdata: IsoXmlObject | undefined,
): string {
  const management =
    taskdata &&
    getAttribute(taskdata, [
      "ManagementSoftwareManufacturer",
      "TaskControllerManufacturer",
    ]);
  if (tasks.length === 1) return tasks[0].name;
  if (tasks.length > 1) return `${tasks.length} tasks · ${sourceLabel}`;
  return management ? `${management} ISOXML package` : sourceLabel;
}

function geometryFromPfd(pfd: IsoXmlObject): SpatialBoundary | undefined {
  const points = findObjects(pfd.children, "PNT")
    .map((point) => {
      const latitude = Number(
        getAttribute(point, ["C", "North", "Latitude", "PositionNorth"]),
      );
      const longitude = Number(
        getAttribute(point, ["D", "East", "Longitude", "PositionEast"]),
      );
      return [latitude, longitude] as [number, number];
    })
    .filter(
      ([latitude, longitude]) =>
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180,
    );
  if (points.length < 3) return undefined;
  return {
    id: pfd.id ?? pfd.uid,
    name:
      getAttribute(pfd, ["C", "PartfieldDesignator", "Designator", "B"]) ??
      pfd.id ??
      "Part field",
    coordinates: points,
    sourceObjectUid: pfd.uid,
  };
}

export async function buildDataset(
  inputFiles: WorkerInputFile[],
  sourceLabel: string,
  onProgress?: (stage: ImportStage, progress: number, detail: string) => void,
): Promise<IsoXmlDataset> {
  stage(onProgress, "reading", 0.06, "Reading local files");
  const expanded = await expandInputFiles(inputFiles);
  const issues: ValidationIssue[] = [...expanded.issues];
  stage(onProgress, "extracting", 0.18, "Package paths and limits checked");

  const xmlFiles = expanded.files.filter((file) =>
    ["taskdata", "xml"].includes(classifyFile(file.path, file.bytes)),
  );
  const taskdataFiles = xmlFiles.filter(
    (file) => classifyFile(file.path, file.bytes) === "taskdata",
  );
  if (!taskdataFiles.length) {
    throw new Error("No TASKDATA.XML file was found in the selected package.");
  }
  if (taskdataFiles.length > 1) {
    issues.push(
      issue({
        severity: "error",
        category: "package",
        code: "PACKAGE_MULTIPLE_TASKDATA",
        message: `${taskdataFiles.length} TASKDATA.XML files were found`,
        explanation:
          "All are preserved; the first is used as the primary document.",
        filename: taskdataFiles[0].path,
        suggestedAction: "Import one complete task-data package at a time.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }
  for (const file of taskdataFiles) {
    if (basename(file.path) !== "TASKDATA.XML") {
      issues.push(
        issue({
          severity: "warning",
          category: "package",
          code: "PACKAGE_UNCONVENTIONAL_TASKDATA_NAME",
          message: `${basename(file.path)} contains task data but has a nonstandard filename`,
          explanation:
            "The ISO11783_TaskData root element was detected from the file contents.",
          filename: file.path,
          suggestedAction: "Use the conventional TASKDATA.XML filename.",
          recovered: true,
          resultsMayBeIncomplete: false,
        }),
      );
    }
  }

  const roots: IsoXmlObject[] = [];
  const rawXmlByFile: Record<string, string> = {};
  const parsedXmlPaths = new Set<string>();
  stage(onProgress, "parsing", 0.3, "Parsing XML without external entities");
  for (const file of xmlFiles) {
    try {
      const xml = textDecoder(file.bytes);
      rawXmlByFile[file.storageKey] = xml;
      roots.push(...parseLosslessXml(xml, file.path, file.storageKey));
      parsedXmlPaths.add(file.storageKey);
    } catch (error) {
      issues.push(
        issue({
          severity: "error",
          category: "xml",
          code: "XML_MALFORMED_OR_UNSAFE",
          message: `${file.path} could not be parsed`,
          explanation:
            error instanceof Error
              ? error.message
              : "Unknown XML parsing error.",
          filename: file.path,
          suggestedAction: "Repair the XML or remove unsafe declarations.",
          recovered: file !== taskdataFiles[0],
          resultsMayBeIncomplete: true,
        }),
      );
      if (file === taskdataFiles[0]) throw error;
    }
  }

  const primaryRoot = roots.find(
    (object) =>
      object.sourceFileKey === taskdataFiles[0].storageKey &&
      object.elementType === "ISO11783_TASKDATA",
  );
  if (!primaryRoot) {
    issues.push(
      issue({
        severity: "error",
        category: "xml",
        code: "XML_INVALID_ROOT",
        message: "The primary XML root is not ISO11783_TaskData",
        explanation: "The exact raw XML remains available.",
        filename: taskdataFiles[0].path,
        suggestedAction: "Check the root element and package type.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  stage(
    onProgress,
    "resolving",
    0.45,
    "Building the object and reference registry",
  );
  const { registry, issues: referenceIssues } = buildRegistry(roots);
  issues.push(...referenceIssues);
  const unknownElementGroups = new Map<string, IsoXmlObject[]>();
  for (const object of registry.all) {
    if (knownElements.has(object.elementType)) continue;
    const key = `${object.sourceFileKey}\u0000${object.elementType}`;
    const group = unknownElementGroups.get(key) ?? [];
    group.push(object);
    unknownElementGroups.set(key, group);
  }
  for (const group of unknownElementGroups.values()) {
    const first = group[0];
    issues.push(
      issue({
        severity: "info",
        category: "support",
        code: "VIEWER_UNKNOWN_ELEMENT",
        message:
          group.length === 1
            ? `${first.elementType} is preserved but has no typed viewer`
            : `${group.length} ${first.elementType} elements are preserved but have no typed viewer`,
        explanation:
          "The exact source remains available in Raw source. Repeated elements of the same type and file are grouped into one note.",
        filename: first.sourceFile,
        objectId: first.id,
        objectType: first.elementType,
        path: first.path,
        relatedObjects: group.slice(0, 100).map((object) => object.uid),
        suggestedAction: "Inspect the raw element or add an extension adapter.",
        recovered: true,
        resultsMayBeIncomplete: false,
      }),
    );
  }

  const taskObjects = findObjects(roots, "TSK");
  const taskInstanceIds = new Map(
    taskObjects.map((taskObject, index) => [
      taskObject,
      `${taskObject.uid}#${index}`,
    ]),
  );
  const grids: DecodedGrid[] = [];
  const gridFilePaths = new Set<string>();
  stage(onProgress, "grids", 0.58, "Resolving and decoding declared grids");
  let gridInstanceIndex = 0;
  for (const taskObject of taskObjects) {
    const gridObjects = findObjects(taskObject.children, "GRD");
    for (const gridObject of gridObjects) {
      const filename =
        (gridObject.attributes.G
          ? /\.[a-z0-9]+$/i.test(gridObject.attributes.G)
            ? gridObject.attributes.G
            : `${gridObject.attributes.G}.BIN`
          : getAttribute(gridObject, ["B", "Filename", "GridFilename"])) ??
        `${gridObject.id ?? "GRID"}.BIN`;
      const binaryFile = findPackageFile(
        expanded.files,
        filename,
        Number(gridObject.attributes.H),
      );
      if (binaryFile) gridFilePaths.add(binaryFile.storageKey);
      const grid = decodeGrid(
        gridObject,
        taskObject,
        registry,
        binaryFile?.bytes,
        {
          gridInstanceId: `${gridObject.uid}#${gridInstanceIndex}`,
          taskInstanceId: taskInstanceIds.get(taskObject) as string,
          sourceBinaryKey: binaryFile?.storageKey,
        },
      );
      gridInstanceIndex += 1;
      grids.push(grid);
      issues.push(...grid.validationIssues);
    }
  }

  stage(onProgress, "timelogs", 0.68, "Decoding executed time-log records");
  const timeLogs: DecodedTimeLog[] = [];
  const timeLogFilePaths = new Set<string>();
  let timeLogInstanceIndex = 0;
  for (const taskObject of taskObjects) {
    const timeLogObjects = findObjects(taskObject.children, "TLG");
    for (const timeLogObject of timeLogObjects) {
      const declaredName =
        getAttribute(timeLogObject, ["A", "Filename"]) ??
        `TLG${String(timeLogInstanceIndex).padStart(5, "0")}`;
      const baseName = declaredName.replace(/\.(?:xml|bin)$/i, "");
      const binaryFilename = `${baseName}.BIN`;
      const headerFilename = `${baseName}.XML`;
      const declaredLength = Number(
        getAttribute(timeLogObject, ["B", "Filelength"]),
      );
      const binaryFile = findPackageFile(
        expanded.files,
        binaryFilename,
        declaredLength,
      );
      const headerFile = findPackageFile(expanded.files, headerFilename);
      const headerRoot = headerFile
        ? roots.find(
            (root) =>
              root.sourceFileKey === headerFile.storageKey &&
              root.elementType === "TIM",
          )
        : undefined;
      if (binaryFile) timeLogFilePaths.add(binaryFile.storageKey);
      if (headerFile) timeLogFilePaths.add(headerFile.storageKey);
      const timeLog = decodeTimeLogWithAdapters({
        timeLogObject,
        taskObject,
        header: headerRoot,
        registry,
        binary: binaryFile?.bytes,
        identity: {
          timeLogInstanceId: `${timeLogObject.uid}#${timeLogInstanceIndex}`,
          taskInstanceId: taskInstanceIds.get(taskObject) as string,
          sourceBinaryKey: binaryFile?.storageKey,
          sourceHeaderKey: headerFile?.storageKey,
          filename: binaryFilename,
          headerFilename,
        },
      });
      timeLogInstanceIndex += 1;
      timeLogs.push(timeLog);
      issues.push(...timeLog.validationIssues);
    }
  }

  stage(onProgress, "spatial", 0.74, "Building spatial boundaries");
  const boundaries = findObjects(roots, "PFD")
    .map(geometryFromPfd)
    .filter((boundary): boundary is SpatialBoundary => Boolean(boundary));

  const tasks: TaskSummary[] = taskObjects.map((taskObject) => {
    const instanceId = taskInstanceIds.get(taskObject) as string;
    const customerId = getAttribute(taskObject, ["C", "CustomerIdRef"]);
    const farmId = getAttribute(taskObject, ["D", "FarmIdRef"]);
    const fieldId = getAttribute(taskObject, ["E", "PartfieldIdRef"]);
    const workerId = getAttribute(taskObject, ["F", "ResponsibleWorkerIdRef"]);
    const customer = resolveOne(registry, customerId, ["CTR"]);
    const farm = resolveOne(registry, farmId, ["FRM"]);
    const field = resolveOne(registry, fieldId, ["PFD"]);
    const worker = resolveOne(registry, workerId, ["WKR"]);
    const taskGrids = grids.filter(
      (grid) => grid.taskInstanceId === instanceId,
    );
    const taskTimeLogs = timeLogs.filter(
      (timeLog) => timeLog.taskInstanceId === instanceId,
    );
    const productIds = new Set(
      taskGrids.flatMap((grid) =>
        grid.channels
          .map((channel) => channel.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const ddiCount = new Set([
      ...taskGrids.flatMap((grid) =>
        grid.channels.map((channel) => channel.ddi),
      ),
      ...taskTimeLogs.flatMap((timeLog) =>
        timeLog.channels.map((channel) => channel.ddi),
      ),
    ]).size;
    const taskId = taskObject.id ?? taskObject.uid;
    return {
      instanceId,
      id: taskId,
      objectUid: taskObject.uid,
      name:
        getAttribute(taskObject, ["B", "TaskDesignator", "Designator"]) ??
        taskId,
      status: getAttribute(taskObject, ["G", "TaskStatus"]) ?? "Unknown",
      customerId,
      customerName: customer
        ? getAttribute(customer, ["B", "CustomerDesignator", "Designator"])
        : undefined,
      farmId,
      farmName: farm
        ? getAttribute(farm, ["B", "FarmDesignator", "Designator"])
        : undefined,
      fieldId,
      fieldName: field
        ? getAttribute(field, ["C", "PartfieldDesignator", "Designator", "B"])
        : undefined,
      workerId,
      workerName: worker
        ? getAttribute(worker, ["B", "WorkerDesignator", "Designator"])
        : undefined,
      gridIds: taskGrids.map((grid) => grid.id),
      timeLogIds: taskTimeLogs.map((timeLog) => timeLog.id),
      productIds: [...productIds],
      ddiCount,
      issueCount: issues.filter(
        (entry) =>
          entry.severity !== "info" &&
          (entry.objectId === taskId ||
            taskGrids.some((grid) => entry.objectId === grid.id) ||
            taskTimeLogs.some((timeLog) => entry.objectId === timeLog.id)),
      ).length,
    };
  });

  stage(
    onProgress,
    "validating",
    0.83,
    "Checking package use and file integrity",
  );
  const rawBytesByFile: Record<string, Uint8Array> = {};
  const files: FileManifestEntry[] = [];
  for (let index = 0; index < expanded.files.length; index += 1) {
    const file = expanded.files[index];
    const kind = classifyFile(file.path, file.bytes);
    const referencedBy = [
      ...grids
        .filter((grid) => grid.sourceBinaryKey === file.storageKey)
        .map((grid) => grid.id),
      ...timeLogs
        .filter(
          (timeLog) =>
            timeLog.sourceBinaryKey === file.storageKey ||
            timeLog.sourceHeaderKey === file.storageKey,
        )
        .map((timeLog) => timeLog.id),
    ];
    const used =
      kind === "archive" ||
      parsedXmlPaths.has(file.storageKey) ||
      gridFilePaths.has(file.storageKey) ||
      timeLogFilePaths.has(file.storageKey) ||
      referencedBy.length > 0;
    rawBytesByFile[file.storageKey] = file.bytes;
    files.push({
      id: `file:${index}:${file.path}`,
      storageKey: file.storageKey,
      path: file.path,
      filename: basename(file.path),
      extension: file.path.includes(".")
        ? `.${file.path.split(".").at(-1)?.toLowerCase()}`
        : "",
      kind,
      size: file.bytes.byteLength,
      checksum: await sha256(file.bytes),
      referencedBy,
      referenceTarget: referencedBy.length ? file.path : undefined,
      parseStatus: parsedXmlPaths.has(file.storageKey)
        ? "parsed"
        : [
              "taskdata",
              "xml",
              "grid-binary",
              "timelog-binary",
              "archive",
            ].includes(kind)
          ? "ready"
          : "unsupported",
      validationStatus: issues.some(
        (entry) => entry.filename === file.path && entry.severity === "error",
      )
        ? "error"
        : issues.some(
              (entry) =>
                entry.filename === file.path && entry.severity === "warning",
            )
          ? "warning"
          : "valid",
      used,
      unresolved:
        (kind === "grid-binary" || kind === "timelog-binary") &&
        !referencedBy.length,
      previewHex: hexPreview(file.bytes),
    });
    if (!used) {
      issues.push(
        issue({
          severity: "info",
          category: "package",
          code: "PACKAGE_UNUSED_FILE",
          message: `${file.path} is not referenced by a supported object`,
          explanation:
            "The file is preserved and remains available for inspection.",
          filename: file.path,
          suggestedAction:
            "Confirm whether the file is an attachment or extension.",
          recovered: true,
          resultsMayBeIncomplete: false,
        }),
      );
    }
  }

  const memoryBytes =
    expanded.files.reduce((sum, file) => sum + file.bytes.byteLength, 0) +
    grids.reduce(
      (sum, grid) =>
        sum +
        grid.treatmentZoneCodes.byteLength +
        grid.rawValues.reduce(
          (channelSum, values) => channelSum + values.byteLength,
          0,
        ),
      0,
    ) +
    timeLogs.reduce(
      (sum, timeLog) =>
        sum +
        timeLog.timestamps.byteLength +
        timeLog.latitudes.byteLength +
        timeLog.longitudes.byteLength +
        timeLog.positionStatus.byteLength +
        timeLog.validPositions.byteLength +
        timeLog.recordByteOffsets.byteLength +
        timeLog.rawValues.reduce(
          (channelSum, values) => channelSum + values.byteLength,
          0,
        ) +
        timeLog.valuePresent.reduce(
          (channelSum, values) => channelSum + values.byteLength,
          0,
        ),
      0,
    );
  const hasErrors = issues.some((entry) => entry.severity === "error");
  const hasWarnings = issues.some((entry) => entry.severity === "warning");
  const versionMajor = primaryRoot
    ? getAttribute(primaryRoot, ["VersionMajor", "A"])
    : undefined;
  const versionMinor = primaryRoot
    ? getAttribute(primaryRoot, ["VersionMinor", "B"])
    : undefined;

  stage(onProgress, "ready", 1, "Dataset ready");
  return {
    id: crypto.randomUUID(),
    title: titleFrom(sourceLabel, tasks, primaryRoot),
    sourceLabel,
    importedAt: new Date().toISOString(),
    versionMajor,
    versionMinor,
    files,
    objects: flattenObjects(roots),
    tasks,
    grids,
    timeLogs,
    boundaries,
    issues,
    rawXmlByFile,
    rawBytesByFile,
    memoryBytes,
    supportSummary: {
      xmlWellFormed: issues.some(
        (entry) => entry.category === "xml" && entry.severity === "error",
      )
        ? "invalid"
        : "valid",
      structural: hasErrors ? "invalid" : hasWarnings ? "warning" : "valid",
      schema: "not-checked",
      references: issues.some(
        (entry) => entry.category === "reference" && entry.severity === "error",
      )
        ? "invalid"
        : issues.some((entry) => entry.category === "reference")
          ? "warning"
          : "valid",
      binary: issues.some(
        (entry) =>
          (entry.category === "grid" || entry.category === "timelog") &&
          entry.severity === "error",
      )
        ? "invalid"
        : issues.some(
              (entry) =>
                entry.category === "grid" || entry.category === "timelog",
            )
          ? "warning"
          : "valid",
      viewer: "partial",
      roundTrip: "preserved-in-memory",
    },
  };
}
