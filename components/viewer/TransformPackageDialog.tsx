"use client";

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Layers3,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  analyzePackageTransform,
  type CleanupTransformPlan,
  type MergeTransformPlan,
  type NewDeviceElementSpec,
  type PackageTransformPlan,
} from "@/lib/isoxml/package-transform";
import type { IsoXmlDataset } from "@/lib/isoxml/types";

interface TransformPackageDialogProps {
  dataset: IsoXmlDataset;
  onCancel: () => void;
  onCreate: (plan: PackageTransformPlan) => Promise<void>;
}

interface NewDeviceElementDraft extends NewDeviceElementSpec {
  draftId: string;
}

export function TransformPackageDialog({
  dataset,
  onCancel,
  onCreate,
}: TransformPackageDialogProps) {
  const dvcObjects = dataset.objects.filter(
    (object) => object.elementType === "DVC" && object.id,
  );
  const [mode, setMode] = useState<"cleanup" | "merge">("cleanup");
  const [variantName, setVariantName] = useState(
    `${dataset.title} transformed`,
  );
  const [mergedTaskName, setMergedTaskName] = useState(
    `Combined ${dataset.tasks[0]?.fieldName ?? "task"}`,
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
  const [detAssignments, setDetAssignments] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        dataset.grids.flatMap((grid) =>
          grid.channels.map((channel) => [
            channel.channelId,
            channel.deviceElementId ?? "",
          ]),
        ),
      ),
  );
  const [newDeviceElements, setNewDeviceElements] = useState<
    NewDeviceElementDraft[]
  >([]);
  const [mergeTaskIds, setMergeTaskIds] = useState(() => new Set<string>());
  const [creating, setCreating] = useState(false);
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
            detAssignments,
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
            mergeTaskIds: [...mergeTaskIds],
            mergedTaskName,
          } satisfies MergeTransformPlan),
    [
      detAssignments,
      keptChannelIds,
      keptGridIds,
      keptTaskIds,
      mergeTaskIds,
      mergedTaskName,
      mode,
      newDeviceElements,
      variantName,
    ],
  );
  const analysis = useMemo(
    () => analyzePackageTransform(dataset, plan),
    [dataset, plan],
  );

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

  const create = async () => {
    if (analysis.blockers.length || creating) return;
    setCreating(true);
    try {
      await onCreate(plan);
    } finally {
      setCreating(false);
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
            <small>NON-DESTRUCTIVE AUTHORING</small>
            <h2 id="transform-dialog-title">Create package variant</h2>
            <p>
              Generate a new ZIP, validate it through the normal importer, and
              select it as a separate local dataset.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            aria-label="Close package variant dialog"
          >
            <X size={16} />
          </button>
        </header>

        <div className="transform-name-row">
          <label>
            <span>Variant name</span>
            <input
              autoFocus
              value={variantName}
              maxLength={120}
              onChange={(event) => setVariantName(event.currentTarget.value)}
              placeholder="North field · controller-ready"
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
            Cleanup & remap
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "merge"}
            className={mode === "merge" ? "active" : ""}
            onClick={() => setMode("merge")}
          >
            <GitMerge size={14} />
            Merge compatible tasks
          </button>
        </div>

        <div className="transform-body">
          <div className="transform-editor">
            {mode === "cleanup" ? (
              <>
                <div className="transform-section-heading">
                  <div>
                    <Trash2 size={14} />
                    <span>Keep or remove package content</span>
                  </div>
                  <small>Unchecked content is removed from the variant</small>
                </div>
                <div className="transform-task-list">
                  {dataset.tasks.map((task) => {
                    const taskKept = keptTaskIds.has(task.id);
                    const grids = dataset.grids.filter(
                      (grid) => grid.taskInstanceId === task.instanceId,
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
                              {task.id} · {task.fieldName ?? "No field"}
                            </small>
                          </span>
                          <b>{grids.length} GRD</b>
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
                                    {grid.rows}×{grid.columns} · Type{" "}
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
                                          {channel.unit ?? "unit unknown"}
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
                                          No DET reference
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
                                              "Unnamed device element"}
                                          </option>
                                        ))}
                                        {newDeviceElements.map((det) => (
                                          <option
                                            key={det.draftId}
                                            value={det.id}
                                          >
                                            {det.id} ·{" "}
                                            {det.designator.trim() ||
                                              "New device element"}{" "}
                                            (new)
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
                      </section>
                    );
                  })}
                </div>
                <div className="transform-det-authoring">
                  <div className="transform-section-heading">
                    <div>
                      <ShieldCheck size={14} />
                      <span>Add DET to an existing device</span>
                    </div>
                    <button
                      type="button"
                      onClick={addDeviceElement}
                      disabled={!dvcObjects.length}
                    >
                      + Add DET
                    </button>
                  </div>
                  {!dvcObjects.length ? (
                    <p className="transform-authoring-note">
                      No DVC is available. Creating a new device graph is
                      outside this quick editor.
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
                              <span>DET ID</span>
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
                              <span>Device</span>
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
                                    {dvc.attributes.B ?? "Unnamed device"}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="designator">
                              <span>Designator</span>
                              <input
                                value={det.designator}
                                maxLength={32}
                                placeholder="e.g. Rear tank"
                                onChange={(event) =>
                                  updateDeviceElement(det.draftId, {
                                    designator: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Type</span>
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
                                <option value={1}>1 · Device</option>
                                <option value={2}>2 · Function</option>
                                <option value={3}>3 · Bin</option>
                                <option value={4}>4 · Section</option>
                                <option value={5}>5 · Unit</option>
                                <option value={6}>6 · Connector</option>
                                <option value={7}>7 · Navigation</option>
                              </select>
                            </label>
                            <label>
                              <span>Object ID</span>
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
                              <span>Element no.</span>
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
                              <span>Parent</span>
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
                                <option value={0}>0 · Device root</option>
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
                                    {parent.designator || parent.id} (new)
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="remove"
                              onClick={() => removeDeviceElement(det.draftId)}
                              aria-label={`Remove new device element ${det.id}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </section>
                        );
                      })}
                      <p className="transform-authoring-note">
                        Required object/type/number/parent fields are
                        preflighted. New DVC, DOR, DPD and DPT authoring remains
                        outside this quick editor.
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
                    <span>Select tasks with aligned Type 2 grids</span>
                  </div>
                  <small>The first selection supplies the resulting IDs</small>
                </div>
                <label className="transform-merged-name">
                  <span>Merged task name</span>
                  <input
                    value={mergedTaskName}
                    maxLength={32}
                    onChange={(event) =>
                      setMergedTaskName(event.currentTarget.value)
                    }
                  />
                </label>
                <div className="transform-merge-list">
                  {dataset.tasks.map((task) => {
                    const grids = dataset.grids.filter(
                      (grid) => grid.taskInstanceId === task.instanceId,
                    );
                    return (
                      <label
                        className="transform-merge-task"
                        key={task.instanceId}
                      >
                        <input
                          type="checkbox"
                          checked={mergeTaskIds.has(task.id)}
                          onChange={(event) =>
                            toggleSetValue(
                              setMergeTaskIds,
                              task.id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span>
                          <strong>{task.name}</strong>
                          <small>
                            {task.id} · {task.fieldName ?? "No field"} ·{" "}
                            {grids.length === 1
                              ? `${grids[0].rows}×${grids[0].columns}, ${grids[0].channels.length} PDV`
                              : `${grids.length} grids`}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="transform-merge-explanation">
                  <PackageCheck size={17} />
                  <p>
                    Merge is allowed only when field/customer/farm, task status,
                    origin, dimensions, cell size, orientation, and decoded cell
                    count match. Different fields are blocked because one TSK
                    can reference only one PFD.
                  </p>
                </div>
              </>
            )}
          </div>

          <aside
            className="transform-preflight"
            aria-label="Transform preflight"
          >
            <div className="transform-section-heading">
              <div>
                <PackageCheck size={14} />
                <span>Preflight</span>
              </div>
            </div>
            {analysis.blockers.length ? (
              <section className="transform-findings blockers">
                <strong>
                  <AlertTriangle size={14} /> {analysis.blockers.length} blocker
                  {analysis.blockers.length === 1 ? "" : "s"}
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
                  <strong>Ready to generate</strong>
                  <small>The result will be re-imported and validated.</small>
                </span>
              </div>
            )}
            {!!analysis.changes.length && (
              <section className="transform-findings changes">
                <strong>Planned changes</strong>
                <ul>
                  {analysis.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </section>
            )}
            {!!analysis.warnings.length && (
              <section className="transform-findings warnings">
                <strong>Notes</strong>
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
            Your source dataset is never modified. Processing and validation
            stay in this browser.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={creating}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={creating || Boolean(analysis.blockers.length)}
            onClick={() => void create()}
          >
            <Sparkles size={14} />
            {creating ? "Creating variant…" : "Create, download & preview"}
          </button>
        </footer>
      </section>
    </div>
  );
}
