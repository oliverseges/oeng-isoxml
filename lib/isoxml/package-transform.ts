import { basename } from "./file-loader";
import type {
  DecodedGrid,
  IsoXmlDataset,
  IsoXmlObject,
  TaskSummary,
} from "./types";
import { assertSafeXml, findObjects } from "./xml-parser";

export interface NewDeviceElementSpec {
  id: string;
  deviceId: string;
  objectId: number;
  elementType: number;
  designator: string;
  elementNumber: number;
  parentObjectId: number;
}

export interface CleanupTransformPlan {
  mode: "cleanup";
  variantName: string;
  keptTaskIds: string[];
  keptGridIds: string[];
  keptChannelIds: string[];
  detAssignments: Record<string, string>;
  newDeviceElements: NewDeviceElementSpec[];
}

export interface MergeTransformPlan {
  mode: "merge";
  variantName: string;
  mergeTaskIds: string[];
  mergedTaskName: string;
}

export type PackageTransformPlan = CleanupTransformPlan | MergeTransformPlan;

export interface TransformAnalysis {
  blockers: string[];
  warnings: string[];
  changes: string[];
}

export interface TransformedPackage {
  file: File;
  analysis: TransformAnalysis;
}

function taskObject(
  dataset: IsoXmlDataset,
  task: TaskSummary,
): IsoXmlObject | undefined {
  return dataset.objects.find((object) => object.uid === task.objectUid);
}

function taskReference(
  dataset: IsoXmlDataset,
  task: TaskSummary,
  summaryValue: string | undefined,
  compactAttribute: string,
  verboseAttribute: string,
): string | undefined {
  const object = taskObject(dataset, task);
  return (
    summaryValue ??
    object?.attributes[compactAttribute] ??
    object?.attributes[verboseAttribute]
  );
}

function gridsForTask(dataset: IsoXmlDataset, taskId: string): DecodedGrid[] {
  return dataset.grids.filter((grid) => grid.taskId === taskId);
}

function gridGeometryMatches(left: DecodedGrid, right: DecodedGrid): boolean {
  const close = (first: number, second: number) =>
    Math.abs(first - second) <=
    Math.max(1e-12, Math.abs(first) * Number.EPSILON * 8);
  return (
    left.gridType === right.gridType &&
    left.rows === right.rows &&
    left.columns === right.columns &&
    left.cellSizeUnit === right.cellSizeUnit &&
    left.originCorner === right.originCorner &&
    close(left.origin.latitude, right.origin.latitude) &&
    close(left.origin.longitude, right.origin.longitude) &&
    close(left.cellSize.northSouth, right.cellSize.northSouth) &&
    close(left.cellSize.eastWest, right.cellSize.eastWest)
  );
}

function unsupportedTaskChildren(task: IsoXmlObject | undefined): string[] {
  if (!task) return ["unresolved task object"];
  return [
    ...new Set(
      task.children
        .map((child) => child.elementType)
        .filter((type) => type !== "TZN" && type !== "GRD"),
    ),
  ];
}

function analyzeCleanup(
  dataset: IsoXmlDataset,
  plan: CleanupTransformPlan,
): TransformAnalysis {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const changes: string[] = [];
  const keptTaskIds = new Set(plan.keptTaskIds);
  const keptGridIds = new Set(plan.keptGridIds);
  const keptChannelIds = new Set(plan.keptChannelIds);
  const detIds = new Set(
    dataset.objects
      .filter((object) => object.elementType === "DET")
      .flatMap((object) => (object.id ? [object.id] : [])),
  );
  plan.newDeviceElements.forEach((det) => detIds.add(det.id.trim()));

  if (!plan.variantName.trim()) blockers.push("Enter a variant name.");
  if (!dataset.tasks.some((task) => keptTaskIds.has(task.id))) {
    blockers.push("Keep at least one task.");
  }

  const knownXmlIds = new Set(
    dataset.objects.flatMap((object) => (object.id ? [object.id] : [])),
  );
  const seenNewIds = new Set<string>();
  const devices = new Map(
    dataset.objects
      .filter((object) => object.elementType === "DVC" && object.id)
      .map((object) => [object.id as string, object]),
  );
  const existingDeviceElements = new Map(
    [...devices].map(([deviceId, device]) => [
      deviceId,
      findObjects(device.children, "DET"),
    ]),
  );
  const plannedObjectIds = new Map<string, Set<number>>();
  for (const [deviceId, elements] of existingDeviceElements) {
    plannedObjectIds.set(
      deviceId,
      new Set(
        elements.flatMap((element) => {
          const value = Number(element.attributes.B);
          return Number.isInteger(value) ? [value] : [];
        }),
      ),
    );
  }
  for (const det of plan.newDeviceElements) {
    const values = plannedObjectIds.get(det.deviceId);
    if (values && Number.isInteger(det.objectId)) values.add(det.objectId);
  }

  const usedObjectIds = new Map<string, Set<number>>();
  const usedElementNumbers = new Map<string, Set<number>>();
  const deviceTypeCounts = new Map<string, number>();
  for (const [deviceId, elements] of existingDeviceElements) {
    usedObjectIds.set(
      deviceId,
      new Set(
        elements.flatMap((element) => {
          const value = Number(element.attributes.B);
          return Number.isInteger(value) ? [value] : [];
        }),
      ),
    );
    usedElementNumbers.set(
      deviceId,
      new Set(
        elements.flatMap((element) => {
          const value = Number(element.attributes.E);
          return Number.isInteger(value) ? [value] : [];
        }),
      ),
    );
    deviceTypeCounts.set(
      deviceId,
      elements.filter((element) => Number(element.attributes.C) === 1).length,
    );
  }

  for (const det of plan.newDeviceElements) {
    const id = det.id.trim();
    const device = devices.get(det.deviceId);
    if (!/^(?:DET|DET-)\d+$/.test(id) || id.length < 4 || id.length > 14) {
      blockers.push(
        `${id || "New DET"} needs an ID such as DET4 or DET-4 (4–14 characters).`,
      );
    } else if (knownXmlIds.has(id) || seenNewIds.has(id)) {
      blockers.push(`${id} is already used as an XML ID.`);
    }
    seenNewIds.add(id);
    if (!device) {
      blockers.push(
        `${id || "New DET"} references unknown device ${det.deviceId}.`,
      );
      continue;
    }
    const objectIds = usedObjectIds.get(det.deviceId) as Set<number>;
    if (
      !Number.isInteger(det.objectId) ||
      det.objectId < 1 ||
      det.objectId > 65_534
    ) {
      blockers.push(`${id} needs a device object ID from 1 to 65534.`);
    } else if (objectIds.has(det.objectId)) {
      blockers.push(
        `${id} device object ID ${det.objectId} is already used in ${det.deviceId}.`,
      );
    }
    objectIds.add(det.objectId);
    if (
      !Number.isInteger(det.elementType) ||
      det.elementType < 1 ||
      det.elementType > 7
    ) {
      blockers.push(`${id} needs a device element type from 1 to 7.`);
    } else if (
      det.elementType === 1 &&
      (deviceTypeCounts.get(det.deviceId) ?? 0) >= 1
    ) {
      blockers.push(`${det.deviceId} already has a type 1 device element.`);
    }
    if (det.elementType === 1) {
      deviceTypeCounts.set(
        det.deviceId,
        (deviceTypeCounts.get(det.deviceId) ?? 0) + 1,
      );
    }
    if (det.designator.length > 32) {
      blockers.push(`${id} designator must be 32 characters or fewer.`);
    }
    const elementNumbers = usedElementNumbers.get(det.deviceId) as Set<number>;
    if (
      !Number.isInteger(det.elementNumber) ||
      det.elementNumber < 0 ||
      det.elementNumber > 4_095
    ) {
      blockers.push(`${id} needs an element number from 0 to 4095.`);
    } else if (elementNumbers.has(det.elementNumber)) {
      blockers.push(
        `${id} element number ${det.elementNumber} is already used in ${det.deviceId}.`,
      );
    }
    elementNumbers.add(det.elementNumber);
    const parentIds = plannedObjectIds.get(det.deviceId) as Set<number>;
    if (
      !Number.isInteger(det.parentObjectId) ||
      det.parentObjectId < 0 ||
      det.parentObjectId > 65_534 ||
      (det.parentObjectId !== 0 && !parentIds.has(det.parentObjectId))
    ) {
      blockers.push(
        `${id} parent object ID must be 0 or another DET object ID in ${det.deviceId}.`,
      );
    } else if (det.parentObjectId === det.objectId) {
      blockers.push(`${id} cannot be its own parent.`);
    }
    changes.push(
      `Add ${id} (${det.designator.trim() || `type ${det.elementType}`}) to ${det.deviceId}.`,
    );
  }

  for (const det of plan.newDeviceElements) {
    if (det.parentObjectId === det.objectId) continue;
    const visited = new Set<number>([det.objectId]);
    let parentObjectId = det.parentObjectId;
    while (parentObjectId !== 0) {
      if (visited.has(parentObjectId)) {
        blockers.push(`${det.id.trim() || "New DET"} creates a parent cycle.`);
        break;
      }
      visited.add(parentObjectId);
      const parent = plan.newDeviceElements.find(
        (candidate) =>
          candidate.deviceId === det.deviceId &&
          candidate.objectId === parentObjectId,
      );
      if (!parent) break;
      parentObjectId = parent.parentObjectId;
    }
  }

  for (const task of dataset.tasks) {
    if (!keptTaskIds.has(task.id)) {
      const object = taskObject(dataset, task);
      if (
        object &&
        (findObjects(object.children, "TLG").length ||
          findObjects(object.children, "DLV").length)
      ) {
        blockers.push(
          `${task.name} contains executed data; task deletion is blocked until executed-data rewriting is supported.`,
        );
      } else {
        changes.push(`Delete task ${task.name} (${task.id}).`);
      }
      continue;
    }

    for (const grid of gridsForTask(dataset, task.id)) {
      if (!keptGridIds.has(grid.id)) {
        changes.push(`Delete grid ${grid.id} and ${grid.filename}.`);
        continue;
      }
      const retainedChannels = grid.channels.filter((channel) =>
        keptChannelIds.has(channel.channelId),
      );
      const changesPdvs =
        retainedChannels.length !== grid.channels.length ||
        retainedChannels.some((channel) => {
          const nextDet = plan.detAssignments[channel.channelId] ?? "";
          return nextDet !== (channel.deviceElementId ?? "");
        });
      if (changesPdvs) {
        const object = taskObject(dataset, task);
        const zones = object ? findObjects(object.children, "TZN") : [];
        if (zones.length !== 1) {
          blockers.push(
            `${task.name} has ${zones.length} treatment zones; PDV edits currently require exactly one.`,
          );
        }
      }
      if (!retainedChannels.length) {
        blockers.push(
          `${grid.id} has no retained PDVs. Delete the grid or keep at least one PDV.`,
        );
        continue;
      }
      if (retainedChannels.length !== grid.channels.length) {
        if (
          grid.gridType !== 2 ||
          grid.decodedCellCount !== grid.expectedCellCount
        ) {
          blockers.push(
            `${grid.id} cannot be rewritten because only complete Type 2 grids support PDV removal.`,
          );
        } else {
          changes.push(
            `Rebuild ${grid.filename} with ${retainedChannels.length} of ${grid.channels.length} PDVs.`,
          );
        }
      }
      for (const channel of retainedChannels) {
        const nextDet = plan.detAssignments[channel.channelId] ?? "";
        const currentDet = channel.deviceElementId ?? "";
        if (nextDet && !detIds.has(nextDet)) {
          blockers.push(
            `${channel.productName ?? channel.ddiDisplay} references unknown DET ${nextDet}.`,
          );
        } else if (nextDet !== currentDet) {
          changes.push(
            `${channel.productName ?? `DDI ${channel.ddiDisplay}`}: ${currentDet || "no DET"} → ${nextDet || "no DET"}.`,
          );
        }
      }
    }
  }

  if (!changes.length) {
    warnings.push(
      "No structural changes are selected; this will create a packaged copy.",
    );
  }
  warnings.push(
    "TASKDATA.XML will be serialized again; unknown elements and attributes are retained, but whitespace and attribute formatting can change.",
  );
  return { blockers, warnings, changes };
}

function analyzeMerge(
  dataset: IsoXmlDataset,
  plan: MergeTransformPlan,
): TransformAnalysis {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const changes: string[] = [];
  const tasks = plan.mergeTaskIds.flatMap((id) => {
    const task = dataset.tasks.find((candidate) => candidate.id === id);
    return task ? [task] : [];
  });

  if (!plan.variantName.trim()) blockers.push("Enter a variant name.");
  if (!plan.mergedTaskName.trim()) blockers.push("Enter a merged task name.");
  if (tasks.length < 2) blockers.push("Select at least two tasks to merge.");
  if (tasks.length !== plan.mergeTaskIds.length) {
    blockers.push("One or more selected tasks no longer exist.");
  }
  if (tasks.length < 2) return { blockers, warnings, changes };

  const taskGrids = tasks.map((task) => gridsForTask(dataset, task.id));
  taskGrids.forEach((grids, index) => {
    if (grids.length !== 1) {
      blockers.push(
        `${tasks[index].name} must contain exactly one grid; found ${grids.length}.`,
      );
    }
  });
  const grids = taskGrids.flatMap((items) => (items.length === 1 ? items : []));
  const firstGrid = grids[0];
  if (firstGrid) {
    for (const grid of grids) {
      if (
        grid.gridType !== 2 ||
        grid.decodedCellCount !== grid.expectedCellCount
      ) {
        blockers.push(
          `${grid.id} must be a complete Type 2 grid before it can be merged.`,
        );
      } else if (!gridGeometryMatches(firstGrid, grid)) {
        blockers.push(
          `${grid.id} does not have the same origin, dimensions, cell size, or orientation as ${firstGrid.id}.`,
        );
      }
    }
  }

  const referenceValues = (
    summaryKey: "customerId" | "farmId" | "fieldId",
    compact: string,
    verbose: string,
  ) =>
    new Set(
      tasks.map((task) =>
        taskReference(dataset, task, task[summaryKey], compact, verbose),
      ),
    );
  const fieldReferences = referenceValues("fieldId", "E", "PartfieldIdRef");
  if (fieldReferences.size !== 1 || fieldReferences.has(undefined)) {
    blockers.push(
      "Selected tasks must share one resolved field. One ISOXML task can reference only one PFD.",
    );
  }
  if (referenceValues("customerId", "C", "CustomerIdRef").size !== 1) {
    blockers.push("The selected tasks reference different customers.");
  }
  if (referenceValues("farmId", "D", "FarmIdRef").size !== 1) {
    blockers.push("The selected tasks reference different farms.");
  }
  if (new Set(tasks.map((task) => task.status)).size !== 1) {
    blockers.push("The selected tasks have different task statuses.");
  }

  for (const task of tasks) {
    const object = taskObject(dataset, task);
    const zones = object ? findObjects(object.children, "TZN") : [];
    if (zones.length !== 1) {
      blockers.push(
        `${task.name} must contain exactly one treatment zone; found ${zones.length}.`,
      );
    }
    const unsupported = unsupportedTaskChildren(object);
    if (unsupported.length) {
      blockers.push(
        `${task.name} contains ${unsupported.join(", ")}. Merge currently supports TZN + GRD task contents only.`,
      );
    }
  }

  const workerIds = new Set(
    tasks.map((task) =>
      taskReference(
        dataset,
        task,
        task.workerId,
        "F",
        "ResponsibleWorkerIdRef",
      ),
    ),
  );
  if (workerIds.size > 1) {
    warnings.push(
      "The tasks reference different workers; the first task's responsible worker will be retained.",
    );
  }
  if (firstGrid) {
    const channelCount = grids.reduce(
      (sum, grid) => sum + grid.channels.length,
      0,
    );
    changes.push(
      `Merge ${tasks.length} tasks into ${tasks[0].id} with one ${channelCount}-PDV grid.`,
    );
    changes.push(
      `Rebuild ${firstGrid.filename}; remove ${Math.max(0, grids.length - 1)} superseded grid file(s).`,
    );
  }
  warnings.push(
    "The first selected task supplies the resulting task ID, grid ID, status, worker, and non-channel metadata.",
  );
  return { blockers, warnings, changes };
}

export function analyzePackageTransform(
  dataset: IsoXmlDataset,
  plan: PackageTransformPlan,
): TransformAnalysis {
  const hasTaskData = dataset.objects.some(
    (object) => object.elementType === "ISO11783_TASKDATA",
  );
  if (!hasTaskData) {
    return {
      blockers: ["The primary ISO11783_TaskData document is unavailable."],
      warnings: [],
      changes: [],
    };
  }
  const analysis =
    plan.mode === "cleanup"
      ? analyzeCleanup(dataset, plan)
      : analyzeMerge(dataset, plan);
  if (
    dataset.issues.some((entry) => entry.code === "PACKAGE_MULTIPLE_TASKDATA")
  ) {
    analysis.blockers.unshift(
      "Package variants require exactly one TASKDATA document. Import the packages separately first.",
    );
  }
  if (dataset.issues.some((entry) => entry.code === "PACKAGE_DUPLICATE_FILE")) {
    analysis.blockers.unshift(
      "Duplicate package paths must be resolved before a variant can be created without dropping evidence.",
    );
  }
  return analysis;
}

function elementsByTag(parent: Document | Element, tagName: string): Element[] {
  return Array.from(parent.getElementsByTagName(tagName));
}

function elementById(
  parent: Document | Element,
  tagName: string,
  id: string,
): Element | undefined {
  return elementsByTag(parent, tagName).find(
    (element) =>
      element.getAttribute("A") === id ||
      element.getAttribute(
        `${tagName[0]}${tagName.slice(1).toLowerCase()}Id`,
      ) === id,
  );
}

function directChildren(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter(
    (child) => child.tagName.toUpperCase() === tagName,
  );
}

function encodeGridChannels(
  gridChannels: Array<{ rawValues: Int32Array }>,
  cellCount: number,
): Uint8Array {
  const bytes = new Uint8Array(cellCount * gridChannels.length * 4);
  const view = new DataView(bytes.buffer);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    for (
      let channelIndex = 0;
      channelIndex < gridChannels.length;
      channelIndex += 1
    ) {
      view.setInt32(
        (cellIndex * gridChannels.length + channelIndex) * 4,
        gridChannels[channelIndex].rawValues[cellIndex],
        true,
      );
    }
  }
  return bytes;
}

function taskElement(document: Document, taskId: string): Element | undefined {
  return elementById(document, "TSK", taskId);
}

function gridElement(task: Element, grid: DecodedGrid): Element | undefined {
  return elementsByTag(task, "GRD").find((element) => {
    const filenameId = (element.getAttribute("G") ?? "").replace(
      /\.[^.]+$/,
      "",
    );
    return (
      filenameId.toUpperCase() ===
        basename(grid.filename)
          .replace(/\.[^.]+$/, "")
          .toUpperCase() || element.getAttribute("GridId") === grid.id
    );
  });
}

function gridFileKey(filename: string): string {
  return basename(filename).toUpperCase();
}

function transformCleanupDocument(
  document: Document,
  dataset: IsoXmlDataset,
  plan: CleanupTransformPlan,
): {
  removedFiles: Set<string>;
  rewrittenFiles: Map<string, Uint8Array>;
} {
  const removedFiles = new Set<string>();
  const rewrittenFiles = new Map<string, Uint8Array>();
  const keptTaskIds = new Set(plan.keptTaskIds);
  const keptGridIds = new Set(plan.keptGridIds);
  const keptChannelIds = new Set(plan.keptChannelIds);

  for (const definition of plan.newDeviceElements) {
    const device = elementById(document, "DVC", definition.deviceId);
    if (!device) continue;
    const element = document.createElement("DET");
    element.setAttribute("A", definition.id.trim());
    element.setAttribute("B", String(definition.objectId));
    element.setAttribute("C", String(definition.elementType));
    if (definition.designator.trim()) {
      element.setAttribute("D", definition.designator.trim());
    }
    element.setAttribute("E", String(definition.elementNumber));
    element.setAttribute("F", String(definition.parentObjectId));
    device.appendChild(element);
  }

  for (const task of dataset.tasks) {
    const element = taskElement(document, task.id);
    if (!element) continue;
    const grids = gridsForTask(dataset, task.id);
    if (!keptTaskIds.has(task.id)) {
      grids.forEach((grid) => removedFiles.add(gridFileKey(grid.filename)));
      element.remove();
      continue;
    }

    for (const grid of grids) {
      const xmlGrid = gridElement(element, grid);
      if (!keptGridIds.has(grid.id)) {
        removedFiles.add(gridFileKey(grid.filename));
        xmlGrid?.remove();
        continue;
      }

      const zone = elementsByTag(element, "TZN")[0];
      if (!zone) continue;
      const xmlPdvs = directChildren(zone, "PDV");
      const retained: Array<{ rawValues: Int32Array }> = [];
      grid.channels.forEach((channel, index) => {
        const xmlPdv = xmlPdvs[index];
        if (!keptChannelIds.has(channel.channelId)) {
          xmlPdv?.remove();
          return;
        }
        const nextDet = plan.detAssignments[channel.channelId] ?? "";
        if (nextDet) xmlPdv?.setAttribute("D", nextDet);
        else xmlPdv?.removeAttribute("D");
        retained.push({ rawValues: grid.rawValues[index] });
      });

      if (retained.length !== grid.channels.length) {
        const bytes = encodeGridChannels(retained, grid.expectedCellCount);
        rewrittenFiles.set(gridFileKey(grid.filename), bytes);
        xmlGrid?.setAttribute("H", String(bytes.byteLength));
      }
    }
  }
  return { removedFiles, rewrittenFiles };
}

function transformMergeDocument(
  document: Document,
  dataset: IsoXmlDataset,
  plan: MergeTransformPlan,
): {
  removedFiles: Set<string>;
  rewrittenFiles: Map<string, Uint8Array>;
} {
  const tasks = plan.mergeTaskIds.map(
    (id) => dataset.tasks.find((task) => task.id === id) as TaskSummary,
  );
  const taskElements = tasks.map(
    (task) => taskElement(document, task.id) as Element,
  );
  const grids = tasks.map(
    (task) => gridsForTask(dataset, task.id)[0] as DecodedGrid,
  );
  const primaryTask = taskElements[0];
  const primaryGrid = grids[0];
  const primaryZone = elementsByTag(primaryTask, "TZN")[0];
  const primaryGridElement = gridElement(primaryTask, primaryGrid);
  const mergedChannels: Array<{ rawValues: Int32Array }> = [];

  grids.forEach((grid) => {
    grid.rawValues.forEach((rawValues) => mergedChannels.push({ rawValues }));
  });
  for (let index = 1; index < taskElements.length; index += 1) {
    const secondaryZone = elementsByTag(taskElements[index], "TZN")[0];
    directChildren(secondaryZone, "PDV").forEach((pdv) => {
      primaryZone.appendChild(pdv.cloneNode(true));
    });
  }

  const bytes = encodeGridChannels(
    mergedChannels,
    primaryGrid.expectedCellCount,
  );
  primaryTask.setAttribute("B", plan.mergedTaskName.trim());
  primaryGridElement?.setAttribute("H", String(bytes.byteLength));

  const removedFiles = new Set<string>();
  for (let index = 1; index < taskElements.length; index += 1) {
    removedFiles.add(gridFileKey(grids[index].filename));
    taskElements[index].remove();
  }
  return {
    removedFiles,
    rewrittenFiles: new Map([[gridFileKey(primaryGrid.filename), bytes]]),
  };
}

function parsePrimaryDocument(dataset: IsoXmlDataset): {
  document: Document;
  taskDataPath: string;
} {
  const root = dataset.objects.find(
    (object) => object.elementType === "ISO11783_TASKDATA",
  );
  if (!root) throw new Error("The primary task-data root is unavailable.");
  const taskDataPath = root.sourceFile;
  const xml = dataset.rawXmlByFile[root.sourceFileKey ?? taskDataPath];
  if (!xml) throw new Error(`${taskDataPath} is not available in memory.`);
  assertSafeXml(xml);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(
      `${taskDataPath} could not be prepared for transformation.`,
    );
  }
  return { document, taskDataPath };
}

function serializedTaskData(document: Document): string {
  const body = new XMLSerializer().serializeToString(document);
  return body.startsWith("<?xml")
    ? body
    : `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function variantFilename(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return `${slug || "isoxml-variant"}.zip`;
}

export async function createTransformedPackage(
  dataset: IsoXmlDataset,
  plan: PackageTransformPlan,
): Promise<TransformedPackage> {
  const analysis = analyzePackageTransform(dataset, plan);
  if (analysis.blockers.length) {
    throw new Error(analysis.blockers.join(" "));
  }
  const { document, taskDataPath } = parsePrimaryDocument(dataset);
  const { removedFiles, rewrittenFiles } =
    plan.mode === "cleanup"
      ? transformCleanupDocument(document, dataset, plan)
      : transformMergeDocument(document, dataset, plan);
  const taskDataBytes = new TextEncoder().encode(serializedTaskData(document));
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const seenPaths = new Set<string>();

  for (const file of dataset.files) {
    if (file.kind === "archive") continue;
    const normalizedPath = file.path.replaceAll("\\", "/");
    const pathKey = normalizedPath.toUpperCase();
    if (seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);
    const fileKey = gridFileKey(file.filename);
    if (removedFiles.has(fileKey)) continue;
    const bytes =
      normalizedPath.toUpperCase() ===
      taskDataPath.replaceAll("\\", "/").toUpperCase()
        ? taskDataBytes
        : (rewrittenFiles.get(fileKey) ??
          dataset.rawBytesByFile[file.storageKey ?? file.path]);
    if (bytes) zip.file(normalizedPath, bytes);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const filename = variantFilename(plan.variantName);
  return {
    file: new File([blob], filename, {
      type: "application/zip",
      lastModified: Date.now(),
    }),
    analysis,
  };
}
