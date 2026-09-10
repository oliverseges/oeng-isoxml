"use client";

import { createI18n } from "@/lib/client/i18n";
import {
    analyzePackageTransform,
    mergeTaskCompatibilityIssues,
    type CleanupTransformPlan,
    type MergeTransformPlan,
    type NewDeviceElementSpec,
    type PackageTransformPlan,
} from "@/lib/isoxml/package-transform";
import type { IsoXmlDataset } from "@/lib/isoxml/types";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    GitMerge,
    Layers3,
    PackageCheck,
    Plus,
    Route,
    ShieldCheck,
    Sparkles,
    Trash2,
    Wrench,
    X,
} from "lucide-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import { useViewerStore } from "./store";

interface TransformPackageDialogProps {
  dataset: IsoXmlDataset;
  initialMode?: "cleanup" | "merge";
  initialVariantName?: string;
  onCancel: () => void;
  onCreate: (
    plan: PackageTransformPlan,
    action: VariantCreationAction,
  ) => Promise<void>;
}

export type VariantCreationAction = "download" | "continue-to-merge";

interface NewDeviceElementDraft extends NewDeviceElementSpec {
  draftId: string;
}

interface MergeGroupDraft {
  draftId: string;
  taskIds: Set<string>;
  mergedTaskName: string;
}

export function TransformPackageDialog({
  dataset,
  initialMode = "cleanup",
  initialVariantName,
  onCancel,
  onCreate,
}: TransformPackageDialogProps) {
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
  const dvcObjects = dataset.objects.filter(
    (object) => object.elementType === "DVC" && object.id,
  );
  const [mode, setMode] = useState<"cleanup" | "merge">(initialMode);
  const [variantName, setVariantName] = useState(
    initialVariantName ??
      i18n.t("{title} transformed", { title: dataset.title }),
  );
  const [keptTaskIds, setKeptTaskIds] = useState(
    () => new Set(dataset.tasks.map((task) => task.id)),
  );
  const [keptGridIds, setKeptGridIds] = useState(
    () => new Set(dataset.grids.map((grid) => grid.id)),
  );
  const [keptChannelIds, setKeptChannelIds] = useState(
    () =>
      new Set(
        dataset.grids.flatMap((grid) =>
          grid.channels.map((channel) => channel.channelId),
        ),
      ),
  );
  const [keptTimeLogIds, setKeptTimeLogIds] = useState(
    () => new Set(dataset.timeLogs.map((timeLog) => timeLog.instanceId)),
  );
  const [detAssignments, setDetAssignments] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        [
          ...dataset.grids.flatMap((grid) => grid.channels),
          ...dataset.timeLogs.flatMap((timeLog) => timeLog.channels),
        ].map((channel) => [channel.channelId, channel.deviceElementId ?? ""]),
      ),
  );
  const [newDeviceElements, setNewDeviceElements] = useState<
    NewDeviceElementDraft[]
  >([]);
  const [executedRiskAccepted, setExecutedRiskAccepted] = useState(false);
  const [mergeGroups, setMergeGroups] = useState<MergeGroupDraft[]>(() => [
    {
      draftId: "merge-1",
      taskIds: new Set<string>(),
      mergedTaskName: i18n.t("Combined {name}", {
        name: dataset.tasks[0]?.fieldName ?? i18n.t("task"),
      }),
    },
  ]);
  const [activeMergeGroupId, setActiveMergeGroupId] = useState("merge-1");
  const mergeGroupCounter = useRef(1);
  const [creatingAction, setCreatingAction] = useState<VariantCreationAction>();
  const creating = Boolean(creatingAction);
  const lastNewDetRef = useRef<HTMLElement>(null);
  const previousNewDetCount = useRef(0);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [creating, onCancel]);

  useEffect(() => {
    if (newDeviceElements.length > previousNewDetCount.current) {
      lastNewDetRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
    previousNewDetCount.current = newDeviceElements.length;
  }, [newDeviceElements.length]);

  const detObjects = dataset.objects.filter(
    (object) => object.elementType === "DET" && object.id,
  );
  const plan = useMemo<PackageTransformPlan>(
    () =>
      mode === "cleanup"
        ? ({
            mode,
            variantName,
            keptTaskIds: [...keptTaskIds],
            keptGridIds: [...keptGridIds],
            keptChannelIds: [...keptChannelIds],
            keptTimeLogIds: [...keptTimeLogIds],
            detAssignments,
            acknowledgeExecutedDataRisk: executedRiskAccepted,
            newDeviceElements: newDeviceElements.map((element) => ({
              id: element.id,
              deviceId: element.deviceId,
              objectId: element.objectId,
              elementType: element.elementType,
              designator: element.designator,
              elementNumber: element.elementNumber,
              parentObjectId: element.parentObjectId,
            })),
          } satisfies CleanupTransformPlan)
        : ({
            mode,
            variantName,
            mergeGroups: mergeGroups.map((group) => ({
              taskIds: [...group.taskIds],
              mergedTaskName: group.mergedTaskName,
            })),
          } satisfies MergeTransformPlan),
    [
      detAssignments,
      executedRiskAccepted,
      keptChannelIds,
      keptGridIds,
      keptTaskIds,
      keptTimeLogIds,
      mergeGroups,
      mode,
      newDeviceElements,
      variantName,
    ],
  );
  const analysis = useMemo(
    () => analyzePackageTransform(dataset, plan),
    [dataset, plan],
  );
  const executedDataChanged = useMemo(
    () =>
      dataset.timeLogs.some((timeLog) => {
        const task = dataset.tasks.find(
          (candidate) => candidate.instanceId === timeLog.taskInstanceId,
        );
        if (task && !keptTaskIds.has(task.id)) return true;
        if (!keptTimeLogIds.has(timeLog.instanceId)) return true;
        return timeLog.channels.some(
          (channel) =>
            (detAssignments[channel.channelId] ??
              channel.deviceElementId ??
              "") !== (channel.deviceElementId ?? ""),
        );
      }),
    [
      dataset.tasks,
      dataset.timeLogs,
      detAssignments,
      keptTaskIds,
      keptTimeLogIds,
    ],
  );
  const activeMergeGroup =
    mergeGroups.find((group) => group.draftId === activeMergeGroupId) ??
    mergeGroups[0];
  const mergeTaskAvailability = useMemo(() => {
    const assignedGroups = new Map<string, string>();
    mergeGroups.forEach((group) => {
      group.taskIds.forEach((taskId) =>
        assignedGroups.set(taskId, group.draftId),
      );
    });
    return Object.fromEntries(
      dataset.tasks.map((task) => {
        const assignedGroupId = assignedGroups.get(task.id);
        if (assignedGroupId && assignedGroupId !== activeMergeGroup.draftId) {
          const groupNumber =
            mergeGroups.findIndex(
              (group) => group.draftId === assignedGroupId,
            ) + 1;
          return [
            task.id,
            {
              disabled: true,
              reason: `Already assigned to Merge ${groupNumber}.`,
              assignedGroupId,
            },
          ];
        }
        if (
          activeMergeGroup.taskIds.has(task.id) ||
          activeMergeGroup.taskIds.size === 0
        ) {
          return [task.id, { disabled: false, reason: "", assignedGroupId }];
        }
        const reasons = mergeTaskCompatibilityIssues(dataset, [
          ...activeMergeGroup.taskIds,
          task.id,
        ]);
        return [
          task.id,
          {
            disabled: reasons.length > 0,
            reason: reasons[0] ?? "",
            assignedGroupId,
          },
        ];
      }),
    ) as Record<
      string,
      { disabled: boolean; reason: string; assignedGroupId?: string }
    >;
  }, [activeMergeGroup, dataset, mergeGroups]);

  const toggleSetValue = (
    setValue: Dispatch<SetStateAction<Set<string>>>,
    id: string,
    checked: boolean,
  ) => {
    setValue((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const usedDetIds = () =>
    new Set([
      ...dataset.objects.flatMap((object) => (object.id ? [object.id] : [])),
      ...newDeviceElements.map((element) => element.id),
    ]);

  const nextDetId = () => {
    const usedIds = usedDetIds();
    let suffix = 1;
    while (usedIds.has(`DET${suffix}`)) suffix += 1;
    return `DET${suffix}`;
  };

  const nextDeviceNumbers = (
    deviceId: string,
    excludedDraftId?: string,
  ): { objectId: number; elementNumber: number } => {
    const device = dvcObjects.find((object) => object.id === deviceId);
    const existing = device
      ? device.children.filter((child) => child.elementType === "DET")
      : [];
    const additions = newDeviceElements.filter(
      (element) =>
        element.deviceId === deviceId && element.draftId !== excludedDraftId,
    );
    const objectIds = [
      ...existing.map((element) => Number(element.attributes.B)),
      ...additions.map((element) => element.objectId),
    ].filter(Number.isInteger);
    const elementNumbers = [
      ...existing.map((element) => Number(element.attributes.E)),
      ...additions.map((element) => element.elementNumber),
    ].filter(Number.isInteger);
    return {
      objectId: Math.max(0, ...objectIds) + 1,
      elementNumber: Math.max(-1, ...elementNumbers) + 1,
    };
  };

  const addDeviceElement = () => {
    const deviceId = dvcObjects[0]?.id;
    if (!deviceId) return;
    const numbers = nextDeviceNumbers(deviceId);
    setNewDeviceElements((current) => [
      ...current,
      {
        draftId: crypto.randomUUID(),
        id: nextDetId(),
        deviceId,
        objectId: numbers.objectId,
        elementType: 2,
        designator: "",
        elementNumber: numbers.elementNumber,
        parentObjectId: 0,
      },
    ]);
  };

  const updateDeviceElement = (
    draftId: string,
    update: Partial<NewDeviceElementSpec>,
  ) => {
    const currentId = newDeviceElements.find(
      (element) => element.draftId === draftId,
    )?.id;
    if (
      currentId !== undefined &&
      update.id !== undefined &&
      update.id !== currentId
    ) {
      const nextId = update.id;
      setDetAssignments((current) =>
        Object.fromEntries(
          Object.entries(current).map(([channelId, detId]) => [
            channelId,
            detId === currentId ? nextId : detId,
          ]),
        ),
      );
    }
    setNewDeviceElements((current) =>
      current.map((element) =>
        element.draftId === draftId ? { ...element, ...update } : element,
      ),
    );
  };

  const removeDeviceElement = (draftId: string) => {
    const id = newDeviceElements.find(
      (element) => element.draftId === draftId,
    )?.id;
    setNewDeviceElements((current) =>
      current.filter((element) => element.draftId !== draftId),
    );
    setDetAssignments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([channelId, detId]) => [
          channelId,
          id !== undefined && detId === id ? "" : detId,
        ]),
      ),
    );
  };

  const updateActiveMergeGroup = (
    update: (group: MergeGroupDraft) => MergeGroupDraft,
  ) => {
    setMergeGroups((current) =>
      current.map((group) =>
        group.draftId === activeMergeGroup.draftId ? update(group) : group,
      ),
    );
  };

  const toggleMergeTask = (taskId: string, checked: boolean) => {
    updateActiveMergeGroup((group) => {
      const taskIds = new Set(group.taskIds);
      if (checked) taskIds.add(taskId);
      else taskIds.delete(taskId);
      return { ...group, taskIds };
    });
  };

  const addMergeGroup = () => {
    mergeGroupCounter.current += 1;
    const draftId = `merge-${mergeGroupCounter.current}`;
    setMergeGroups((current) => [
      ...current,
      {
        draftId,
        taskIds: new Set<string>(),
        mergedTaskName: `${i18n.t("Combined {name}", {
          name: dataset.tasks[0]?.fieldName ?? i18n.t("task"),
        })} ${mergeGroupCounter.current}`,
      },
    ]);
    setActiveMergeGroupId(draftId);
  };

  const removeActiveMergeGroup = () => {
    if (mergeGroups.length === 1) return;
    const remaining = mergeGroups.filter(
      (group) => group.draftId !== activeMergeGroup.draftId,
    );
    setMergeGroups(remaining);
    setActiveMergeGroupId(remaining[0].draftId);
  };

  const create = async (action: VariantCreationAction = "download") => {
    if (analysis.blockers.length || creating) return;
    setCreatingAction(action);
    try {
      await onCreate(plan, action);
    } finally {
      setCreatingAction(undefined);
    }
  };

  return (
    <div className="transform-overlay">
      <section
        className="transform-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transform-dialog-title"
      >
        <header className="transform-heading">
          <div className="transform-heading-icon">
            <Sparkles size={19} aria-hidden="true" />
          </div>
          <div>
            <small>{i18n.t("Non-destructive authoring").toUpperCase()}</small>
            <h2 id="transform-dialog-title">{i18n.t("Create package variant")}</h2>
            <p>
              {i18n.t(
                "Generate a new ZIP, validate it through the normal importer, and select it as a separate local dataset.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            aria-label={i18n.t("Close package variant dialog")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="transform-name-row">
          <label>
            <span>{i18n.t("Variant name")}</span>
            <input
              autoFocus
              value={variantName}
              maxLength={120}
              onChange={(event) => setVariantName(event.currentTarget.value)}
              placeholder={i18n.t("North field · controller-ready")}
            />
          </label>
          <span>.zip</span>
        </div>

        <div className="transform-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cleanup"}
            className={mode === "cleanup" ? "active" : ""}
            onClick={() => setMode("cleanup")}
          >
            <Wrench size={14} />
            {i18n.t("Cleanup & remap")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "merge"}
            className={mode === "merge" ? "active" : ""}
            onClick={() => setMode("merge")}
          >
            <GitMerge size={14} />
            {i18n.t("Merge compatible tasks")}
          </button>
        </div>

        <div className="transform-body">
          <div className="transform-editor">
            {mode === "cleanup" ? (
              <>
                <div className="transform-section-heading">
                  <div>
                    <Trash2 size={14} />
                    <span>{i18n.t("Keep or remove package content")}</span>
                  </div>
                  <small>{i18n.t("Unchecked content is removed from the variant")}</small>
                </div>
                {!!dataset.timeLogs.length && (
                  <section
                    className={`transform-executed-warning${executedDataChanged ? " active" : ""}`}
                  >
                    <AlertTriangle size={20} aria-hidden="true" />
                    <div>
                      <strong>{i18n.t("Executed-data editing is unlocked")}</strong>
                      <p>
                        {i18n.t(
                          "You may remove a complete time log or remap its DLV device-element references. Record bytes are preserved; individual executed channels cannot be removed because that would change sparse binary indexes.",
                        )}
                      </p>
                      {executedDataChanged && (
                        <label>
                          <input
                            type="checkbox"
                            checked={executedRiskAccepted}
                            onChange={(event) =>
                              setExecutedRiskAccepted(
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span>
                            {i18n.t(
                              "I understand that the generated variant changes executed-data evidence and must be verified before downstream use.",
                            )}
                          </span>
                        </label>
                      )}
                    </div>
                  </section>
                )}
                <div className="transform-task-list">
                  {dataset.tasks.map((task) => {
                    const taskKept = keptTaskIds.has(task.id);
                    const grids = dataset.grids.filter(
                      (grid) => grid.taskInstanceId === task.instanceId,
                    );
                    const timeLogs = dataset.timeLogs.filter(
                      (timeLog) => timeLog.taskInstanceId === task.instanceId,
                    );
                    return (
                      <section className="transform-task" key={task.instanceId}>
                        <label className="transform-check-row task">
                          <input
                            type="checkbox"
                            checked={taskKept}
                            onChange={(event) =>
                              toggleSetValue(
                                setKeptTaskIds,
                                task.id,
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span>
                            <strong>{task.name}</strong>
                            <small>
                              {task.id} · {task.fieldName ?? i18n.t("No field")}
                            </small>
                          </span>
                          <b>
                            {grids.length} GRD · {timeLogs.length} TLG
                          </b>
                        </label>
                        {grids.map((grid) => {
                          const gridKept = taskKept && keptGridIds.has(grid.id);
                          return (
                            <div
                              className="transform-grid"
                              key={grid.instanceId}
                            >
                              <label className="transform-check-row grid">
                                <input
                                  type="checkbox"
                                  disabled={!taskKept}
                                  checked={gridKept}
                                  onChange={(event) =>
                                    toggleSetValue(
                                      setKeptGridIds,
                                      grid.id,
                                      event.currentTarget.checked,
                                    )
                                  }
                                />
                                <Layers3 size={14} aria-hidden="true" />
                                <span>
                                  <strong>{grid.id}</strong>
                                  <small>
                                    {grid.rows}×{grid.columns} · {i18n.t("Type")}{" "}
                                    {grid.gridType} · {grid.filename}
                                  </small>
                                </span>
                              </label>
                              {grid.channels.map((channel) => {
                                const channelKept =
                                  gridKept &&
                                  keptChannelIds.has(channel.channelId);
                                return (
                                  <div
                                    className="transform-channel"
                                    key={channel.channelId}
                                  >
                                    <label className="transform-check-row channel">
                                      <input
                                        type="checkbox"
                                        disabled={!gridKept}
                                        checked={channelKept}
                                        onChange={(event) =>
                                          toggleSetValue(
                                            setKeptChannelIds,
                                            channel.channelId,
                                            event.currentTarget.checked,
                                          )
                                        }
                                      />
                                      <span>
                                        <strong>
                                          {channel.productName ??
                                            `DDI ${channel.ddiDisplay}`}
                                        </strong>
                                        <small>
                                          DDI {channel.ddiDisplay} · PDV{" "}
                                          {channel.pdvIndex + 1} ·{" "}
                                          {channel.unit ?? i18n.t("unit unknown")}
                                        </small>
                                      </span>
                                    </label>
                                    <label className="transform-det-select">
                                      <span>DET</span>
                                      <select
                                        disabled={!channelKept}
                                        value={
                                          detAssignments[channel.channelId] ??
                                          ""
                                        }
                                        onChange={(event) => {
                                          const detId =
                                            event.currentTarget.value;
                                          setDetAssignments((current) => ({
                                            ...current,
                                            [channel.channelId]: detId,
                                          }));
                                        }}
                                      >
                                        <option value="">
                                          {i18n.t("No DET reference")}
                                        </option>
                                        {detObjects.map((det, detIndex) => (
                                          <option
                                            key={`${det.uid}:${detIndex}`}
                                            value={det.id}
                                          >
                                            {det.id} ·{" "}
                                            {det.attributes.D ??
                                              det.attributes
                                                .DeviceElementDesignator ??
                                              i18n.t("Unnamed device element")}
                                          </option>
                                        ))}
                                        {newDeviceElements.map((det) => (
                                          <option
                                            key={det.draftId}
                                            value={det.id}
                                          >
                                            {det.id} ·{" "}
                                            {det.designator.trim() ||
                                              i18n.t("New device element")}{" "}
                                            ({i18n.t("new")})
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                        {timeLogs.map((timeLog) => {
                          const timeLogKept =
                            taskKept && keptTimeLogIds.has(timeLog.instanceId);
                          return (
                            <div
                              className="transform-timelog"
                              key={timeLog.instanceId}
                            >
                              <label className="transform-check-row timelog">
                                <input
                                  type="checkbox"
                                  disabled={!taskKept}
                                  checked={timeLogKept}
                                  onChange={(event) =>
                                    toggleSetValue(
                                      setKeptTimeLogIds,
                                      timeLog.instanceId,
                                      event.currentTarget.checked,
                                    )
                                  }
                                />
                                <Route size={14} aria-hidden="true" />
                                <span>
                                  <strong>{timeLog.id}</strong>
                                  <small>
                                    {i18n.t("counts.records", {
                                      count: timeLog.decodedRecordCount,
                                    })}{" "}
                                    · {timeLog.headerFilename} ·{" "}
                                    {timeLog.filename}
                                  </small>
                                </span>
                                <b>{timeLog.channels.length} DDI</b>
                              </label>
                              {timeLogKept &&
                                timeLog.channels.map((channel) => (
                                  <div
                                    className="transform-channel executed"
                                    key={channel.channelId}
                                  >
                                    <div className="transform-executed-channel-label">
                                      <span>
                                        <strong>
                                          DDI {channel.ddiDisplay} ·{" "}
                                          {channel.ddiName}
                                        </strong>
                                        <small>
                                          DLV {channel.dlvIndex + 1} ·{" "}
                                          {channel.unit ?? i18n.t("unit unknown")}
                                        </small>
                                      </span>
                                    </div>
                                    <label className="transform-det-select">
                                      <span>{i18n.t("DLV device element")}</span>
                                      <select
                                        value={
                                          detAssignments[channel.channelId] ??
                                          channel.deviceElementId ??
                                          ""
                                        }
                                        onChange={(event) => {
                                          const detId =
                                            event.currentTarget.value;
                                          setDetAssignments((current) => ({
                                            ...current,
                                            [channel.channelId]: detId,
                                          }));
                                        }}
                                      >
                                        <option value="">
                                          {i18n.t("No DET reference")}
                                        </option>
                                        {detObjects.map((det, detIndex) => (
                                          <option
                                            key={`${det.uid}:${detIndex}`}
                                            value={det.id}
                                          >
                                            {det.id} ·{" "}
                                            {det.attributes.D ??
                                              det.attributes
                                                .DeviceElementDesignator ??
                                              i18n.t("Unnamed device element")}
                                          </option>
                                        ))}
                                        {newDeviceElements.map((det) => (
                                          <option
                                            key={det.draftId}
                                            value={det.id}
                                          >
                                            {det.id} ·{" "}
                                            {det.designator.trim() ||
                                              i18n.t("New device element")}{" "}
                                            ({i18n.t("new")})
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
                <div className="transform-det-authoring">
                  <div className="transform-section-heading">
                    <div>
                      <ShieldCheck size={14} />
                      <span>{i18n.t("Add DET to an existing device")}</span>
                    </div>
                    <button
                      type="button"
                      onClick={addDeviceElement}
                      disabled={!dvcObjects.length}
                    >
                      + {i18n.t("Add DET")}
                    </button>
                  </div>
                  {!dvcObjects.length ? (
                    <p className="transform-authoring-note">
                      {i18n.t(
                        "No DVC is available. Creating a new device graph is outside this quick editor.",
                      )}
                    </p>
                  ) : (
                    <>
                      {newDeviceElements.map((det, index) => {
                        const device = dvcObjects.find(
                          (object) => object.id === det.deviceId,
                        );
                        const existingParents = device
                          ? device.children.filter(
                              (child) => child.elementType === "DET",
                            )
                          : [];
                        const newParents = newDeviceElements.filter(
                          (candidate) =>
                            candidate.deviceId === det.deviceId &&
                            candidate.id !== det.id,
                        );
                        return (
                          <section
                            className="transform-new-det"
                            key={det.draftId}
                            ref={
                              index === newDeviceElements.length - 1
                                ? lastNewDetRef
                                : undefined
                            }
                          >
                            <label>
                              <span>{i18n.t("DET ID")}</span>
                              <input
                                value={det.id}
                                maxLength={14}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    id: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>{i18n.t("Device")}</span>
                              <select
                                value={det.deviceId}
                                onChange={(event) => {
                                  const deviceId = event.currentTarget.value;
                                  updateDeviceElement(det.draftId, {
                                    deviceId,
                                    ...nextDeviceNumbers(deviceId, det.draftId),
                                    parentObjectId: 0,
                                  });
                                }}
                              >
                                {dvcObjects.map((dvc, dvcIndex) => (
                                  <option
                                    key={`${dvc.uid}:${dvcIndex}`}
                                    value={dvc.id}
                                  >
                                    {dvc.id} ·{" "}
                                    {dvc.attributes.B ?? i18n.t("Unnamed device")}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="designator">
                              <span>{i18n.t("Designator")}</span>
                              <input
                                value={det.designator}
                                maxLength={32}
                                placeholder={i18n.t("e.g. Rear tank")}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    designator: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>{i18n.t("Type")}</span>
                              <select
                                value={det.elementType}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    elementType: Number(
                                      event.currentTarget.value,
                                    ),
                                  })
                                }
                              >
                                <option value={1}>1 · {i18n.t("Device")}</option>
                                <option value={2}>2 · {i18n.t("Function")}</option>
                                <option value={3}>3 · {i18n.t("Bin")}</option>
                                <option value={4}>4 · {i18n.t("Section")}</option>
                                <option value={5}>5 · {i18n.t("Unit")}</option>
                                <option value={6}>6 · {i18n.t("Connector")}</option>
                                <option value={7}>7 · {i18n.t("Navigation")}</option>
                              </select>
                            </label>
                            <label>
                              <span>{i18n.t("Object ID")}</span>
                              <input
                                type="number"
                                min={1}
                                max={65_534}
                                value={det.objectId}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    objectId: Number(event.currentTarget.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>{i18n.t("Element no.")}</span>
                              <input
                                type="number"
                                min={0}
                                max={4_095}
                                value={det.elementNumber}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    elementNumber: Number(
                                      event.currentTarget.value,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label className="parent">
                              <span>{i18n.t("Parent")}</span>
                              <select
                                value={det.parentObjectId}
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    parentObjectId: Number(
                                      event.currentTarget.value,
                                    ),
                                  })
                                }
                              >
                                <option value={0}>0 · {i18n.t("Device root")}</option>
                                {existingParents.map((parent) => (
                                  <option
                                    key={parent.uid}
                                    value={Number(parent.attributes.B)}
                                  >
                                    {parent.attributes.B} ·{" "}
                                    {parent.attributes.D ?? parent.id}
                                  </option>
                                ))}
                                {newParents.map((parent) => (
                                  <option
                                    key={parent.draftId}
                                    value={parent.objectId}
                                  >
                                    {parent.objectId} ·{" "}
                                    {parent.designator || parent.id} ({i18n.t("new")})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="remove"
                              onClick={() => removeDeviceElement(det.draftId)}
                              aria-label={i18n.t("Remove new device element {id}", {
                                id: det.id,
                              })}
                            >
                              <Trash2 size={14} />
                            </button>
                          </section>
                        );
                      })}
                      <p className="transform-authoring-note">
                        {i18n.t(
                          "Required object/type/number/parent fields are preflighted. New DVC, DOR, DPD and DPT authoring remains outside this quick editor.",
                        )}
                      </p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="transform-section-heading">
                  <div>
                    <GitMerge size={14} />
                    <span>{i18n.t("Build independent compatible merge groups")}</span>
                  </div>
                  <small>{i18n.t("Unassigned tasks remain unchanged")}</small>
                </div>
                <div
                  className="transform-merge-groups"
                  role="tablist"
                  aria-label={i18n.t("Task merge groups")}
                >
                  {mergeGroups.map((group, index) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={group.draftId === activeMergeGroup.draftId}
                      className={
                        group.draftId === activeMergeGroup.draftId
                          ? "active"
                          : ""
                      }
                      onClick={() => setActiveMergeGroupId(group.draftId)}
                      key={group.draftId}
                    >
                      <span>{i18n.t("Merge {index}", { index: index + 1 })}</span>
                      <b>
                        {i18n.t("counts.tasks", { count: group.taskIds.size })}
                      </b>
                    </button>
                  ))}
                  <button type="button" className="add" onClick={addMergeGroup}>
                    <Plus size={13} aria-hidden="true" /> {i18n.t("New merge")}
                  </button>
                </div>
                <div className="transform-merge-group-editor">
                  <label className="transform-merged-name">
                    <span>{i18n.t("Merged task name")}</span>
                    <input
                      value={activeMergeGroup.mergedTaskName}
                      maxLength={32}
                      onChange={(event) => {
                        const mergedTaskName = event.currentTarget.value;
                        updateActiveMergeGroup((group) => ({
                          ...group,
                          mergedTaskName,
                        }));
                      }}
                    />
                  </label>
                  {mergeGroups.length > 1 && (
                    <button
                      type="button"
                      className="remove-merge-group"
                      onClick={removeActiveMergeGroup}
                    >
                      <Trash2 size={13} aria-hidden="true" /> {i18n.t("Remove group")}
                    </button>
                  )}
                </div>
                <div className="transform-merge-list">
                  {dataset.tasks.map((task) => {
                    const grids = dataset.grids.filter(
                      (grid) => grid.taskInstanceId === task.instanceId,
                    );
                    const availability = mergeTaskAvailability[task.id];
                    const checked = activeMergeGroup.taskIds.has(task.id);
                    const assignedIndex = availability.assignedGroupId
                      ? mergeGroups.findIndex(
                          (group) =>
                            group.draftId === availability.assignedGroupId,
                        )
                      : -1;
                    return (
                      <label
                        className={`transform-merge-task${availability.disabled ? " disabled" : ""}`}
                        title={availability.reason || undefined}
                        key={task.instanceId}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={availability.disabled}
                          onChange={(event) =>
                            toggleMergeTask(
                              task.id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span>
                          <strong>{task.name}</strong>
                          <small>
                            {task.id} · {task.fieldName ?? i18n.t("No field")} ·{" "}
                            {grids.length === 1
                              ? `${grids[0].rows}×${grids[0].columns}, ${grids[0].channels.length} PDV`
                              : `${grids.length} grids`}
                          </small>
                          {!!availability.reason && (
                            <em>{availability.reason}</em>
                          )}
                        </span>
                        {assignedIndex >= 0 && (
                          <b className="transform-merge-assignment">
                            {i18n.t("Merge {index}", { index: assignedIndex + 1 })}
                          </b>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="transform-merge-explanation">
                  <PackageCheck size={17} />
                  <p>
                    {i18n.t(
                      "Merge is allowed only when field/customer/farm, task status, origin, dimensions, cell size, orientation, and decoded cell count match. Different fields are blocked because one TSK can reference only one PFD. After the first task is checked, incompatible choices are disabled with the blocking reason.",
                    )}
                  </p>
                </div>
              </>
            )}
          </div>

          <aside
            className="transform-preflight"
            aria-label={i18n.t("Transform preflight")}
          >
            <div className="transform-section-heading">
              <div>
                <PackageCheck size={14} />
                <span>{i18n.t("Preflight")}</span>
              </div>
            </div>
            {analysis.blockers.length ? (
              <section className="transform-findings blockers">
                <strong>
                  <AlertTriangle size={14} /> {analysis.blockers.length === 1
                    ? i18n.t("1 blocker")
                    : i18n.t("{count} blockers", {
                        count: analysis.blockers.length,
                      })}
                </strong>
                <ul>
                  {analysis.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </section>
            ) : (
              <div className="transform-ready">
                <CheckCircle2 size={17} />
                <span>
                  <strong>{i18n.t("Ready to generate")}</strong>
                  <small>{i18n.t("The result will be re-imported and validated.")}</small>
                </span>
              </div>
            )}
            {!!analysis.changes.length && (
              <section className="transform-findings changes">
                <strong>{i18n.t("Planned changes")}</strong>
                <ul>
                  {analysis.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </section>
            )}
            {!!analysis.warnings.length && (
              <section className="transform-findings warnings">
                <strong>{i18n.t("Notes")}</strong>
                <ul>
                  {analysis.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>

        <footer className="transform-actions">
          <p>
            {i18n.t(
              "Your source dataset is never modified. Processing and validation stay in this browser.",
            )}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={creating}
            onClick={onCancel}
          >
            Cancel
          </button>
          {mode === "cleanup" && (
            <button
              type="button"
              className="transform-continue-button"
              disabled={creating || Boolean(analysis.blockers.length)}
              onClick={() => void create("continue-to-merge")}
            >
              <ArrowRight size={14} />
              {creatingAction === "continue-to-merge"
                ? i18n.t("Applying cleanup…")
                : i18n.t("Apply & continue to merge")}
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={creating || Boolean(analysis.blockers.length)}
            onClick={() => void create("download")}
          >
            <Sparkles size={14} />
            {creatingAction === "download"
              ? i18n.t("Creating variant…")
              : i18n.t("Create, download & preview")}
          </button>
        </footer>
      </section>
    </div>
  );
}
