"use client";

import { copyTextToClipboard } from "@/lib/client/clipboard";
import { createI18n } from "@/lib/client/i18n";
import type { DdiDefinition } from "@/lib/isoxml/ddi-catalog";
import { basename } from "@/lib/isoxml/file-loader";
import type {
    DecodedGrid,
    GridChannel,
    IsoXmlDataset,
    IsoXmlObject,
} from "@/lib/isoxml/types";
import { decodeValue } from "@/lib/isoxml/value-decoder";
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
import { useEffect, useMemo, useState } from "react";
import { INSPECTOR_TABS, visibleInspectorTab } from "./inspector-tabs";
import { useViewerStore } from "./store";

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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
  const selectedCellIndex = useViewerStore((state) => state.selectedCellIndex);
  const setSelectedCell = useViewerStore((state) => state.setSelectedCell);
  const inspectorTab = useViewerStore((state) => state.inspectorTab);
  const setInspectorTab = useViewerStore((state) => state.setInspectorTab);
  const activeInspectorTab = visibleInspectorTab(inspectorTab, false);
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
  > = [["TSK", taskObject, task?.name ?? i18n.t("Task unresolved")]];
  if (customerId) {
    relationships.push([
      "CTR",
      customerObject,
      customerName ?? i18n.t("Customer unresolved"),
    ]);
  }
  if (farmId) {
    relationships.push([
      "FRM",
      farmObject,
      `${farmName ?? i18n.t("Farm unresolved")} · ${i18n.t("Customer").toLowerCase()} ${farmObject?.attributes.I ?? customerId ?? i18n.t("unresolved")}`,
    ]);
  }
  if (fieldId) {
    relationships.push([
      "PFD",
      fieldObject,
      `${fieldName ?? i18n.t("Field unresolved")} · ${i18n.t("Farm").toLowerCase()} ${fieldObject?.attributes.F ?? farmId ?? i18n.t("unresolved")}`,
    ]);
  }
  if (workerId) {
    relationships.push([
      "WKR",
      workerObject,
      workerName ?? i18n.t("Worker unresolved"),
    ]);
  }
  relationships.push(
    ["PDV", pdvObject, i18n.t("Ordered process variable")],
    ["PDT", productObject, channel.productName ?? i18n.t("Product unresolved")],
    [
      "DET",
      deviceObject,
      channel.deviceElementName ?? i18n.t("Device element unresolved"),
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
    <aside className="right-panel" aria-label={i18n.t("Object inspector")}>
      <div className="inspector-heading">
        <div className="selection-icon">
          <MapPin size={16} />
        </div>
        <div>
          <small>{i18n.t("Pinned selection").toUpperCase()}</small>
          <strong>{i18n.t("Grid cell")} #{cellIndex}</strong>
          <span>
            {i18n.t("Row")} {row + 1} · {i18n.t("Column")} {column + 1}
          </span>
        </div>
        <div className="selection-nav">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={i18n.t("Previous cell")}
            disabled={cellIndex <= 0}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label={i18n.t("Next cell")}
            disabled={cellIndex >= grid.decodedCellCount - 1}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label={i18n.t("Inspector views")}
      >
        {INSPECTOR_TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeInspectorTab === tab.id}
            className={activeInspectorTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setInspectorTab(tab.id)}
          >
            {i18n.t(tab.label)}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {activeInspectorTab === "overview" && (
          <>
            <section className="inspector-value-card">
              <div>
                <small>{i18n.t("Scaled value").toUpperCase()}</small>
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
                {i18n.t(channel.presentation.confidence)}
              </span>
              <div className="value-formula">
                ({decoded?.rawValue ?? "?"} + {channel.presentation.offset}) ×{" "}
                {channel.presentation.scale}
              </div>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>{i18n.t("Task context")}</span>
              </div>
              <dl className="property-list">
                <div>
                  <dt>{i18n.t("Customer")}</dt>
                  <dd>
                    {customerName ?? i18n.t("Not referenced")}{" "}
                    {customerId && (
                      <span className="code-chip">{customerId}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Farm")}</dt>
                  <dd>
                    {farmName ?? i18n.t("Not referenced")}{" "}
                    {farmId && <span className="code-chip">{farmId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Field")}</dt>
                  <dd>
                    {fieldName ?? i18n.t("Not referenced")}{" "}
                    {fieldId && <span className="code-chip">{fieldId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Worker")}</dt>
                  <dd>
                    {workerName ?? i18n.t("Not referenced")}{" "}
                    {workerId && <span className="code-chip">{workerId}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Status")}</dt>
                  <dd>{task?.status ?? i18n.t("Unknown")}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>{i18n.t("Channel identity")}</span>
                <button
                  type="button"
                  onClick={() => void copyTextToClipboard(channel.channelId)}
                >
                  <Clipboard size={12} /> {i18n.t("Copy").toUpperCase()}
                </button>
              </div>
              <dl className="property-list">
                <div>
                  <dt>{i18n.t("Task")}</dt>
                  <dd>{task?.name}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Grid")}</dt>
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
                  <dt>{i18n.t("PDV order")}</dt>
                  <dd>
                    {channel.pdvIndex + 1} {i18n.t("of")} {grid.channels.length}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Product")}</dt>
                  <dd>{channel.productName ?? i18n.t("Allocation unresolved")}</dd>
                </div>
                <div>
                  <dt>DET</dt>
                  <dd>{channel.deviceElementName ?? i18n.t("Reference missing")}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Raw value")}</dt>
                  <dd className="mono">{decoded?.rawValue ?? "—"}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Cell layout")}</dt>
                  <dd>
                    {grid.gridType === 2
                      ? i18n.t("Direct PDV values")
                      : i18n.t("Treatment zone {zone}", {
                          zone: grid.treatmentZoneCodes[cellIndex],
                        })}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Unit")}</dt>
                  <dd>{channel.unit ?? i18n.t("Not declared")}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>{i18n.t("ISOBUS DDI reference")}</span>
                {ddiDefinition?.officialUrl && (
                  <a
                    href={ddiDefinition.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={i18n.t(
                      "Open the official ISOBUS entry for DDI {ddi}",
                      { ddi: channel.ddiDisplay },
                    )}
                  >
                    {i18n.t("Official").toUpperCase()} <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <p className="ddi-definition">
                {ddiDefinition?.description ?? i18n.t("Loading DDI reference…")}
              </p>
              <dl className="property-list">
                <div>
                  <dt>{i18n.t("Unit symbol")}</dt>
                  <dd>{ddiDefinition?.unitSymbol ?? i18n.t("Not defined")}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Bit resolution")}</dt>
                  <dd>{ddiDefinition?.bitResolution ?? i18n.t("Not defined")}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Display range")}</dt>
                  <dd>{ddiDefinition?.displayRange ?? i18n.t("Not defined")}</dd>
                </div>
                <div>
                  <dt>{i18n.t("CANBus range")}</dt>
                  <dd>{ddiDefinition?.canBusRange ?? i18n.t("Not defined")}</dd>
                </div>
                {ddiDefinition?.comment && (
                  <div className="multiline">
                    <dt>{i18n.t("Comment")}</dt>
                    <dd>{ddiDefinition.comment}</dd>
                  </div>
                )}
                <div className="multiline">
                  <dt>{i18n.t("Device classes")}</dt>
                  <dd>
                    {ddiDefinition?.deviceClasses.length
                      ? ddiDefinition.deviceClasses
                          .map(
                            (deviceClass) =>
                              `${deviceClass.id} – ${deviceClass.name}`,
                          )
                          .join(", ")
                      : i18n.t("Not assigned")}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("Status")}</dt>
                  <dd>{ddiDefinition?.status ?? i18n.t("Not defined")}</dd>
                </div>
                <div>
                  <dt>{i18n.t("Revision")}</dt>
                  <dd>{ddiDefinition?.revision ?? i18n.t("Not defined")}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>{i18n.t("Evidence chain")}</span>
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
                  {grid.gridType === 2 ? i18n.t("Cell").toUpperCase() : "TZN"}{" "}
                  <b>
                    {grid.gridType === 2
                      ? i18n.t("Direct").toUpperCase()
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

        {activeInspectorTab === "attributes" && (
          <section className="inspector-section flush">
            <div className="section-title">
              <span>{i18n.t("Raw PDV attributes")}</span>
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
              {i18n.t(
                "Compact attributes are kept verbatim. Typed names are decoded only within an element-specific vocabulary.",
              )}
            </div>
          </section>
        )}

        {activeInspectorTab === "relationships" && (
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
                    <strong>{typedObject?.id ?? i18n.t("Unresolved")}</strong>
                    <p>{String(description)}</p>
                  </div>
                  {typedObject ? (
                    <CheckCircle2 size={13} aria-label={i18n.t("Resolved")} />
                  ) : (
                    <AlertTriangle size={13} aria-label={i18n.t("Unresolved")} />
                  )}
                </article>
              );
            })}
          </section>
        )}

        {activeInspectorTab === "source" && (
          <>
            <section className="inspector-section">
              <div className="section-title">
                <span>{i18n.t("XML source")}</span>
              </div>
              <div className="source-location">
                <FileLabel label={pdvObject?.sourceFile ?? "TASKDATA.XML"} />
                <code>{pdvObject?.path ?? i18n.t("Path unavailable")}</code>
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
                <span>{i18n.t("Binary source")}</span>
                <b>INT32 LE</b>
              </div>
              <div className="binary-offset">
                <span>{i18n.t("Byte offset")}</span>
                <strong>
                  0x{binaryOffset.toString(16).padStart(8, "0").toUpperCase()}
                </strong>
                <small>
                  {i18n.t("Cell {cell} · channel {channel}", {
                    cell: cellIndex,
                    channel: channel.pdvIndex + 1,
                  })}
                </small>
              </div>
              <pre className="hex-block">
                {hexWindow(sourceBytes(dataset, grid), binaryOffset)}
              </pre>
              <button
                className="jump-source-button"
                onClick={() => useViewerStore.getState().setBottomTab("source")}
              >
                <Braces size={14} /> {i18n.t("Open full source panel")}
              </button>
            </section>
          </>
        )}

        {activeInspectorTab === "validation" && (
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
                {i18n.t("No issues are attached to this selection.")}
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
