import { flattenObjects, inferObjectId } from "./object-model";
import { buildRegistry } from "./reference-resolver";
import type { IsoXmlDataset, IsoXmlObject } from "./types";

function refreshObjectIds(object: IsoXmlObject): IsoXmlObject {
  const children = object.children.map(refreshObjectIds);
  const id = inferObjectId(object.elementType, object.attributes);
  const childrenChanged = children.some(
    (child, index) => child !== object.children[index],
  );
  const sourceFileKey = object.sourceFileKey ?? object.sourceFile;
  return id !== object.id ||
    childrenChanged ||
    sourceFileKey !== object.sourceFileKey
    ? { ...object, id, children, sourceFileKey }
    : object;
}

export function refreshDatasetReferenceMetadata(
  dataset: IsoXmlDataset,
): IsoXmlDataset {
  const childUids = new Set(
    dataset.objects.flatMap((object) =>
      object.children.map((child) => child.uid),
    ),
  );
  const storedRoots = dataset.objects.filter(
    (object) => !childUids.has(object.uid),
  );
  const refreshedRoots = (
    storedRoots.length ? storedRoots : dataset.objects
  ).map(refreshObjectIds);
  const objects = flattenObjects(refreshedRoots);
  const { issues: referenceIssues } = buildRegistry(refreshedRoots);
  const issues = [
    ...dataset.issues.filter((entry) => entry.category !== "reference"),
    ...referenceIssues,
  ];
  const hasErrors = issues.some((entry) => entry.severity === "error");
  const hasWarnings = issues.some((entry) => entry.severity === "warning");
  const referenceErrors = referenceIssues.some(
    (entry) => entry.severity === "error",
  );
  const referenceWarnings = referenceIssues.some(
    (entry) => entry.severity === "warning",
  );
  const binaryIssues = issues.filter(
    (entry) => entry.category === "grid" || entry.category === "timelog",
  );
  const tasks = (dataset.tasks ?? []).map((task, index) => ({
    ...task,
    instanceId: task.instanceId ?? `${task.objectUid}#${index}`,
    timeLogIds: task.timeLogIds ?? [],
    issueCount: issues.filter(
      (entry) =>
        entry.severity !== "info" &&
        (entry.objectId === task.id ||
          task.gridIds.includes(entry.objectId ?? "") ||
          task.timeLogIds.includes(entry.objectId ?? "")),
    ).length,
  }));
  const grids = (dataset.grids ?? []).map((grid, index) => ({
    ...grid,
    instanceId: grid.instanceId ?? `${grid.sourceObjectUid}#${index}`,
    taskInstanceId:
      grid.taskInstanceId ??
      tasks.find((task) => task.id === grid.taskId)?.instanceId ??
      grid.taskId,
  }));
  const timeLogs = (dataset.timeLogs ?? []).map((timeLog) => ({
    ...timeLog,
    adapterSelection: timeLog.adapterSelection ?? {
      adapterId: timeLog.timeLogType === 1 ? "native-isoxml-type-1" : undefined,
      adapterLabel:
        timeLog.timeLogType === 1 ? "Native ISOXML Type 1" : undefined,
      mode:
        timeLog.timeLogType === 1
          ? ("automatic" as const)
          : ("unresolved" as const),
      confidence:
        timeLog.timeLogType === 1 ? ("medium" as const) : ("none" as const),
      reason:
        timeLog.timeLogType === 1
          ? "Restored from an earlier viewer version and assigned to the native Type 1 adapter."
          : "No decoder adapter selection was stored with this dataset.",
      candidates: [],
    },
  }));
  return {
    ...dataset,
    objects,
    issues,
    ...(dataset.files
      ? {
          files: dataset.files.map((file) => ({
            ...file,
            storageKey: file.storageKey ?? file.path,
            validationStatus: issues.some(
              (entry) =>
                entry.filename === file.path && entry.severity === "error",
            )
              ? ("error" as const)
              : issues.some(
                    (entry) =>
                      entry.filename === file.path &&
                      entry.severity === "warning",
                  )
                ? ("warning" as const)
                : ("valid" as const),
          })),
        }
      : {}),
    ...(dataset.tasks ? { tasks } : {}),
    ...(dataset.grids ? { grids } : {}),
    timeLogs,
    ...(dataset.supportSummary
      ? {
          supportSummary: {
            ...dataset.supportSummary,
            structural: hasErrors
              ? ("invalid" as const)
              : hasWarnings
                ? ("warning" as const)
                : ("valid" as const),
            references: referenceErrors
              ? ("invalid" as const)
              : referenceWarnings
                ? ("warning" as const)
                : ("valid" as const),
            binary: binaryIssues.some((entry) => entry.severity === "error")
              ? ("invalid" as const)
              : binaryIssues.some((entry) => entry.severity === "warning")
                ? ("warning" as const)
                : ("valid" as const),
          },
        }
      : {}),
  };
}
