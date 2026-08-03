"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Braces,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Link2,
  MapPin,
} from "lucide-react";
import type { DdiDefinition } from "@/lib/isoxml/ddi-catalog";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import { basename } from "@/lib/isoxml/file-loader";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import type {
  DecodedGrid,
  GridChannel,
  IsoXmlDataset,
  IsoXmlObject,
} from "@/lib/isoxml/types";
import { useViewerStore, type InspectorTab } from "./store";

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "attributes", label: "Attributes" },
  { id: "relationships", label: "Relations" },
  { id: "source", label: "Source" },
  { id: "validation", label: "Validation" },
];

function sourceBytes(
  dataset: IsoXmlDataset,
  grid: DecodedGrid,
): Uint8Array | undefined {
  if (grid.sourceBinaryKey) {
    return dataset.rawBytesByFile[grid.sourceBinaryKey];
  }
  const path = Object.keys(dataset.rawBytesByFile).find(
    (candidate) =>
      basename(candidate).toUpperCase() ===
      basename(grid.filename).toUpperCase(),
  );
  return path ? dataset.rawBytesByFile[path] : undefined;
}

function hexWindow(bytes: Uint8Array | undefined, offset: number): string {
  if (!bytes) return "Binary source unavailable";
  const start = Math.max(0, offset - 8);
  const end = Math.min(bytes.byteLength, offset + 16);
  return Array.from(bytes.slice(start, end))
    .map((byte, index) => {
      const position = start + index;
      const value = byte.toString(16).padStart(2, "0").toUpperCase();
      return position >= offset && position < offset + 4 ? `[${value}]` : value;
    })
    .join(" ");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

interface InspectorProps {
  dataset: IsoXmlDataset;
  grid: DecodedGrid;
  channel: GridChannel;
}

export function Inspector({ dataset, grid, channel }: InspectorProps) {
  const selectedCellIndex = useViewerStore((state) => state.selectedCellIndex);
  const setSelectedCell = useViewerStore((state) => state.setSelectedCell);
  const inspectorTab = useViewerStore((state) => state.inspectorTab);
  const setInspectorTab = useViewerStore((state) => state.setInspectorTab);
  const channelIndex = grid.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const cellIndex =
    grid.decodedCellCount > 0
      ? Math.min(Math.max(selectedCellIndex ?? 0, 0), grid.decodedCellCount - 1)
      : 0;
  const raw = grid.rawValues[channelIndex]?.[cellIndex];
  const decoded =
    raw === undefined ? undefined : decodeValue(raw, channel.presentation);
  const row = Math.floor(cellIndex / grid.columns);
  const column = cellIndex % grid.columns;
  const binaryOffset =
    cellIndex * grid.bytesPerCell +
    (grid.gridType === 2 ? channel.pdvIndex * 4 : 0);
  const pdvObject = dataset.objects.find(
    (object) => object.uid === channel.pdvObjectUid,
  );
  const productObject = dataset.objects.find(
    (object) => object.id === channel.productId,
  );
  const deviceObject = dataset.objects.find(
    (object) => object.id === channel.deviceElementId,
  );
  const presentationObject = dataset.objects.find(
    (object) => object.id === channel.valuePresentationId,
  );
  const task = dataset.tasks.find(
    (candidate) => candidate.instanceId === grid.taskInstanceId,
  );
  const taskObject = dataset.objects.find(
    (object) => object.uid === task?.objectUid,
  );
  const customerId =
    task?.customerId ??
    taskObject?.attributes.C ??
    taskObject?.attributes.CustomerIdRef;
  const farmId =
    task?.farmId ??
    taskObject?.attributes.D ??
    taskObject?.attributes.FarmIdRef;
  const fieldId =
    task?.fieldId ??
    taskObject?.attributes.E ??
    taskObject?.attributes.PartfieldIdRef;
  const workerId =
    task?.workerId ??
    taskObject?.attributes.F ??
    taskObject?.attributes.ResponsibleWorkerIdRef;
  const customerObject = dataset.objects.find(
    (object) => object.elementType === "CTR" && object.id === customerId,
  );
  const farmObject = dataset.objects.find(
    (object) => object.elementType === "FRM" && object.id === farmId,
  );
  const fieldObject = dataset.objects.find(
    (object) => object.elementType === "PFD" && object.id === fieldId,
  );
  const workerObject = dataset.objects.find(
    (object) => object.elementType === "WKR" && object.id === workerId,
  );
  const customerName =
    customerObject?.attributes.B ??
    customerObject?.attributes.CustomerDesignator ??
    task?.customerName;
  const farmName =
    farmObject?.attributes.B ??
    farmObject?.attributes.FarmDesignator ??
    task?.farmName;
  const fieldName =
    fieldObject?.attributes.C ??
    fieldObject?.attributes.PartfieldDesignator ??
    fieldObject?.attributes.B ??
    task?.fieldName;
  const workerName =
    workerObject?.attributes.B ??
    workerObject?.attributes.WorkerDesignator ??
    task?.workerName;
  const relationships: Array<
    [type: string, object: IsoXmlObject | undefined, description: string]
  > = [["TSK", taskObject, task?.name ?? "Task unresolved"]];
  if (customerId) {
    relationships.push([
      "CTR",
      customerObject,
      customerName ?? "Customer unresolved",
    ]);
  }
  if (farmId) {
    relationships.push([
      "FRM",
      farmObject,
      `${farmName ?? "Farm unresolved"} · customer ${farmObject?.attributes.I ?? customerId ?? "unresolved"}`,
    ]);
  }
  if (fieldId) {
    relationships.push([
      "PFD",
      fieldObject,
      `${fieldName ?? "Field unresolved"} · farm ${fieldObject?.attributes.F ?? farmId ?? "unresolved"}`,
    ]);
  }
  if (workerId) {
    relationships.push([
      "WKR",
      workerObject,
      workerName ?? "Worker unresolved",
    ]);
  }
  relationships.push(
    ["PDV", pdvObject, "Ordered process variable"],
    ["PDT", productObject, channel.productName ?? "Product unresolved"],
    [
      "DET",
      deviceObject,
      channel.deviceElementName ?? "Device element unresolved",
    ],
    [
      presentationObject?.elementType ?? "VPN/DVP",
      presentationObject,
      channel.presentation.source,
    ],
  );
  const relatedIssues = useMemo(
    () =>
      dataset.issues.filter(
        (issue) =>
          issue.objectId === grid.id ||
          issue.objectId === channel.productId ||
          issue.relatedObjects.includes(channel.pdvObjectUid),
      ),
    [channel, dataset.issues, grid.id],
  );
  const [ddiReference, setDdiReference] = useState<{
    ddi: number;
    definition: DdiDefinition;
  }>();
  const ddiDefinition =
    ddiReference?.ddi === channel.ddi ? ddiReference.definition : undefined;

  useEffect(() => {
    let active = true;
    void import("@/lib/isoxml/ddi-catalog").then(({ describeDdiDetails }) => {
      if (active) {
        setDdiReference({
          ddi: channel.ddi,
          definition: describeDdiDetails(channel.ddi),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [channel.ddi]);

  const navigate = (delta: number) => {
    if (!grid.decodedCellCount) return;
    setSelectedCell(
      Math.max(0, Math.min(grid.decodedCellCount - 1, cellIndex + delta)),
    );
  };

  return (
    <aside className="right-panel" aria-label="Object inspector">
      <div className="inspector-heading">
        <div className="selection-icon">
          <MapPin size={16} />
        </div>
        <div>
          <small>PINNED SELECTION</small>
          <strong>Grid cell #{cellIndex}</strong>
          <span>
            Row {row + 1} · Column {column + 1}
          </span>
        </div>
        <div className="selection-nav">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Previous cell"
            disabled={cellIndex <= 0}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Next cell"
            disabled={cellIndex >= grid.decodedCellCount - 1}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Inspector views"
      >
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={inspectorTab === tab.id}
            className={inspectorTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setInspectorTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {inspectorTab === "overview" && (
          <>
            <section className="inspector-value-card">
              <div>
                <small>SCALED VALUE</small>
                <strong>
                  {decoded?.formattedValue ?? "—"}
                  <span>{channel.unit}</span>
                </strong>
              </div>
              <span className={`confidence ${channel.presentation.confidence}`}>
                {channel.presentation.confidence === "declared" ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <AlertTriangle size={12} />
                )}
                {channel.presentation.confidence}
              </span>
              <div className="value-formula">
                ({decoded?.rawValue ?? "?"} + {channel.presentation.offset}) ×{" "}
                {channel.presentation.scale}
              </div>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Task context</span>
              </div>
              <dl className="property-list">
                <div>
                  <dt>Customer</dt>
                  <dd>
                    {customerName ?? "Not referenced"}{" "}
                    {customerId && (
                      <span className="code-chip">{customerId}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Farm</dt>
                  <dd>
                    {farmName ?? "Not referenced"}{" "}
                    {farmId && <span className="code-chip">{farmId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Field</dt>
                  <dd>
                    {fieldName ?? "Not referenced"}{" "}
                    {fieldId && <span className="code-chip">{fieldId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Worker</dt>
                  <dd>
                    {workerName ?? "Not referenced"}{" "}
                    {workerId && <span className="code-chip">{workerId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{task?.status ?? "Unknown"}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Channel identity</span>
                <button
                  type="button"
                  onClick={() => void copyTextToClipboard(channel.channelId)}
                >
                  <Clipboard size={12} /> COPY
                </button>
              </div>
              <dl className="property-list">
                <div>
                  <dt>Task</dt>
                  <dd>{task?.name}</dd>
                </div>
                <div>
                  <dt>Grid</dt>
                  <dd className="mono">{grid.id}</dd>
                </div>
                <div>
                  <dt>DDI</dt>
                  <dd>
                    <span className="code-chip">{channel.ddiDisplay}</span>{" "}
                    {channel.ddiName}
                  </dd>
                </div>
                <div>
                  <dt>PDV order</dt>
                  <dd>
                    {channel.pdvIndex + 1} of {grid.channels.length}
                  </dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{channel.productName ?? "Allocation unresolved"}</dd>
                </div>
                <div>
                  <dt>DET</dt>
                  <dd>{channel.deviceElementName ?? "Reference missing"}</dd>
                </div>
                <div>
                  <dt>Raw value</dt>
                  <dd className="mono">{decoded?.rawValue ?? "—"}</dd>
                </div>
                <div>
                  <dt>Cell layout</dt>
                  <dd>
                    {grid.gridType === 2
                      ? "Direct PDV values"
                      : `Treatment zone ${grid.treatmentZoneCodes[cellIndex]}`}
                  </dd>
                </div>
                <div>
                  <dt>Unit</dt>
                  <dd>{channel.unit ?? "Not declared"}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>ISOBUS DDI reference</span>
                {ddiDefinition?.officialUrl && (
                  <a
                    href={ddiDefinition.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open the official ISOBUS entry for DDI ${channel.ddiDisplay}`}
                  >
                    OFFICIAL <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <p className="ddi-definition">
                {ddiDefinition?.description ?? "Loading DDI reference…"}
              </p>
              <dl className="property-list">
                <div>
                  <dt>Unit symbol</dt>
                  <dd>{ddiDefinition?.unitSymbol ?? "Not defined"}</dd>
                </div>
                <div>
                  <dt>Bit resolution</dt>
                  <dd>{ddiDefinition?.bitResolution ?? "Not defined"}</dd>
                </div>
                <div>
                  <dt>Display range</dt>
                  <dd>{ddiDefinition?.displayRange ?? "Not defined"}</dd>
                </div>
                <div>
                  <dt>CANBus range</dt>
                  <dd>{ddiDefinition?.canBusRange ?? "Not defined"}</dd>
                </div>
                {ddiDefinition?.comment && (
                  <div className="multiline">
                    <dt>Comment</dt>
                    <dd>{ddiDefinition.comment}</dd>
                  </div>
                )}
                <div className="multiline">
                  <dt>Device classes</dt>
                  <dd>
                    {ddiDefinition?.deviceClasses.length
                      ? ddiDefinition.deviceClasses
                          .map(
                            (deviceClass) =>
                              `${deviceClass.id} – ${deviceClass.name}`,
                          )
                          .join(", ")
                      : "Not assigned"}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{ddiDefinition?.status ?? "Not defined"}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{ddiDefinition?.revision ?? "Not defined"}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Evidence chain</span>
              </div>
              <div className="evidence-chain">
                <span>
                  TSK <b>{grid.taskId}</b>
                </span>
                <i>→</i>
                <span>
                  GRD <b>{grid.id}</b>
                </span>
                <i>→</i>
                <span>
                  {grid.gridType === 2 ? "CELL" : "TZN"}{" "}
                  <b>
                    {grid.gridType === 2
                      ? "DIRECT"
                      : grid.treatmentZoneCodes[cellIndex]}
                  </b>
                </span>
                <i>→</i>
                <span>
                  PDV <b>#{channel.pdvIndex + 1}</b>
                </span>
                <i>→</i>
                <span>
                  PDT <b>{channel.productId ?? "?"}</b>
                </span>
              </div>
            </section>
          </>
        )}

        {inspectorTab === "attributes" && (
          <section className="inspector-section flush">
            <div className="section-title">
              <span>Raw PDV attributes</span>
            </div>
            <dl className="attribute-grid">
              {Object.entries(pdvObject?.attributes ?? {}).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ),
              )}
            </dl>
            <div className="source-note">
              Compact attributes are kept verbatim. Typed names are decoded only
              within an element-specific vocabulary.
            </div>
          </section>
        )}

        {inspectorTab === "relationships" && (
          <section className="relationship-list">
            {relationships.map(([type, object, description]) => {
              const typedObject = object;
              return (
                <article
                  key={String(type)}
                  className={!typedObject ? "unresolved" : ""}
                >
                  <span className="relation-icon">
                    <Link2 size={14} />
                  </span>
                  <div>
                    <small>{String(type)}</small>
                    <strong>{typedObject?.id ?? "Unresolved"}</strong>
                    <p>{String(description)}</p>
                  </div>
                  {typedObject ? (
                    <CheckCircle2 size={13} aria-label="Resolved" />
                  ) : (
                    <AlertTriangle size={13} aria-label="Unresolved" />
                  )}
                </article>
              );
            })}
          </section>
        )}

        {inspectorTab === "source" && (
          <>
            <section className="inspector-section">
              <div className="section-title">
                <span>XML source</span>
              </div>
              <div className="source-location">
                <FileLabel label={pdvObject?.sourceFile ?? "TASKDATA.XML"} />
                <code>{pdvObject?.path ?? "Path unavailable"}</code>
              </div>
              <pre className="code-block">
                {`<PDV ${Object.entries(pdvObject?.attributes ?? {})
                  .map(
                    ([key, value]) => `${key}="${escapeXmlAttribute(value)}"`,
                  )
                  .join(" ")} />`}
              </pre>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Binary source</span>
                <b>INT32 LE</b>
              </div>
              <div className="binary-offset">
                <span>Byte offset</span>
                <strong>
                  0x{binaryOffset.toString(16).padStart(8, "0").toUpperCase()}
                </strong>
                <small>
                  Cell {cellIndex} · channel {channel.pdvIndex + 1}
                </small>
              </div>
              <pre className="hex-block">
                {hexWindow(sourceBytes(dataset, grid), binaryOffset)}
              </pre>
              <button
                type="button"
                className="jump-source-button"
                onClick={() => useViewerStore.getState().setBottomTab("source")}
              >
                <Braces size={14} /> Open full source panel
              </button>
            </section>
          </>
        )}

        {inspectorTab === "validation" && (
          <section className="issue-cards">
            {relatedIssues.length ? (
              relatedIssues.map((issue, issueIndex) => (
                <article
                  key={`${issue.id}:${issueIndex}`}
                  className={`issue-card ${issue.severity}`}
                >
                  <AlertTriangle size={15} />
                  <div>
                    <small>{issue.code}</small>
                    <strong>{issue.message}</strong>
                    <p>{issue.explanation}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="inspector-empty">
                <CheckCircle2 size={22} />
                No issues are attached to this selection.
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function FileLabel({ label }: { label: string }) {
  return (
    <span className="file-label">
      <Braces size={13} />
      {label}
    </span>
  );
}
