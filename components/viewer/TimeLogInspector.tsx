"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Braces,
  CheckCircle2,
  Clock3,
  Link2,
  MapPin,
} from "lucide-react";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import type {
  DecodedTimeLog,
  IsoXmlDataset,
  IsoXmlObject,
  TimeLogChannel,
} from "@/lib/isoxml/types";
import { TIME_LOG_INSPECTOR_TABS } from "./inspector-tabs";
import { useViewerStore } from "./store";
import { TimeLogAdapterControl } from "./TimeLogAdapterControl";

function hexWindow(bytes: Uint8Array | undefined, offset: number): string {
  if (!bytes) return "Binary source unavailable";
  const start = Math.max(0, offset - 8);
  const end = Math.min(bytes.byteLength, offset + 32);
  return Array.from(bytes.slice(start, end))
    .map((byte, index) => {
      const position = start + index;
      const value = byte.toString(16).padStart(2, "0").toUpperCase();
      return position >= offset && position < offset + 6 ? `[${value}]` : value;
    })
    .join(" ");
}

function objectName(object: IsoXmlObject | undefined): string {
  if (!object) return "Unresolved";
  return (
    object.attributes.D ??
    object.attributes.E ??
    object.attributes.B ??
    object.id ??
    object.elementType
  );
}

interface TimeLogInspectorProps {
  dataset: IsoXmlDataset;
  timeLog: DecodedTimeLog;
  channel: TimeLogChannel;
  onSelectAdapter: (adapterId?: string) => void;
  adapterBusy?: boolean;
}

export function TimeLogInspector({
  dataset,
  timeLog,
  channel,
  onSelectAdapter,
  adapterBusy,
}: TimeLogInspectorProps) {
  const selectedRecordIndex = useViewerStore(
    (state) => state.selectedCellIndex,
  );
  const setSelectedRecord = useViewerStore((state) => state.setSelectedCell);
  const inspectorTab = useViewerStore((state) => state.inspectorTab);
  const setInspectorTab = useViewerStore((state) => state.setInspectorTab);
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const recordIndex = Math.min(
    Math.max(selectedRecordIndex ?? 0, 0),
    Math.max(0, timeLog.decodedRecordCount - 1),
  );
  const valueIsPresent = Boolean(
    timeLog.valuePresent[channelIndex]?.[recordIndex],
  );
  const raw = valueIsPresent
    ? timeLog.rawValues[channelIndex]?.[recordIndex]
    : undefined;
  const decoded =
    raw === undefined ? undefined : decodeValue(raw, channel.presentation);
  const timestamp = timeLog.timestamps[recordIndex];
  const binaryOffset = timeLog.recordByteOffsets[recordIndex] ?? 0;
  const binaryBytes = timeLog.sourceBinaryKey
    ? dataset.rawBytesByFile[timeLog.sourceBinaryKey]
    : undefined;
  const deviceElement = dataset.objects.find(
    (object) =>
      object.elementType === "DET" && object.id === channel.deviceElementId,
  );
  const device = dataset.objects.find(
    (object) => object.elementType === "DVC" && object.id === channel.deviceId,
  );
  const processData = dataset.objects.find(
    (object) =>
      (object.elementType === "DPD" || object.elementType === "DPT") &&
      object.id === channel.processDataObjectId &&
      (!device || object.path.startsWith(device.path)),
  );
  const presentation = dataset.objects.find(
    (object) =>
      object.elementType === "DVP" &&
      object.id === channel.valuePresentationId &&
      (!device || object.path.startsWith(device.path)),
  );
  const declaration = dataset.objects.find(
    (object) => object.uid === timeLog.sourceObjectUid,
  );
  const task = dataset.tasks.find(
    (candidate) => candidate.instanceId === timeLog.taskInstanceId,
  );
  const taskObject = dataset.objects.find(
    (object) => object.uid === task?.objectUid,
  );
  const relationships: Array<[string, IsoXmlObject | undefined, string]> = [
    ["TSK", taskObject, task?.name ?? "Task unresolved"],
    ["TLG", declaration, timeLog.id],
    ["DVC", device, channel.deviceName ?? "Machine unresolved"],
    ["DET", deviceElement, channel.deviceElementName ?? "Element unresolved"],
    [
      processData?.elementType ?? "DPD/DPT",
      processData,
      objectName(processData),
    ],
    ["DVP", presentation, channel.presentation.source],
  ];
  const [ddiName, setDdiName] = useState(channel.ddiName);

  useEffect(() => {
    let active = true;
    void import("@/lib/isoxml/ddi-catalog").then(({ describeDdiDetails }) => {
      if (active) setDdiName(describeDdiDetails(channel.ddi).name);
    });
    return () => {
      active = false;
    };
  }, [channel.ddi]);

  const navigate = (direction: -1 | 1) => {
    for (
      let candidate = recordIndex + direction;
      candidate >= 0 && candidate < timeLog.decodedRecordCount;
      candidate += direction
    ) {
      if (timeLog.valuePresent[channelIndex]?.[candidate]) {
        setSelectedRecord(candidate);
        return;
      }
    }
  };
  const hasPrevious = timeLog.valuePresent[channelIndex]
    ?.slice(0, recordIndex)
    .some(Boolean);
  const hasNext = timeLog.valuePresent[channelIndex]
    ?.slice(recordIndex + 1)
    .some(Boolean);

  return (
    <aside className="right-panel" aria-label="Executed record inspector">
      <div className="inspector-heading">
        <div className="selection-icon executed">
          <MapPin size={16} />
        </div>
        <div>
          <small>EXECUTED SELECTION</small>
          <strong>Time-log record #{recordIndex + 1}</strong>
          <span>
            {Number.isFinite(timestamp)
              ? new Date(timestamp).toLocaleString()
              : "Timestamp unavailable"}
          </span>
        </div>
        <div className="selection-nav">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Previous recorded value"
            disabled={!hasPrevious}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Next recorded value"
            disabled={!hasNext}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div
        className="inspector-tabs has-adapter"
        role="tablist"
        aria-label="Inspector views"
      >
        {TIME_LOG_INSPECTOR_TABS.map((tab) => (
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
            <section className="inspector-value-card executed">
              <div>
                <small>SCALED EXECUTED VALUE</small>
                <strong>
                  {decoded?.formattedValue ?? "Not recorded"}
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
                {decoded
                  ? `(${decoded.rawValue} + ${channel.presentation.offset}) × ${channel.presentation.scale}`
                  : "Sparse DLV: this channel is absent from this record"}
              </div>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Recorded position</span>
              </div>
              <dl className="property-list">
                <div>
                  <dt>Latitude</dt>
                  <dd>{timeLog.latitudes[recordIndex]?.toFixed(7) ?? "—"}</dd>
                </div>
                <div>
                  <dt>Longitude</dt>
                  <dd>{timeLog.longitudes[recordIndex]?.toFixed(7) ?? "—"}</dd>
                </div>
                <div>
                  <dt>Position status</dt>
                  <dd>{timeLog.positionStatus[recordIndex]}</dd>
                </div>
                <div>
                  <dt>Valid for map</dt>
                  <dd>{timeLog.validPositions[recordIndex] ? "yes" : "no"}</dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Executed channel</span>
              </div>
              <dl className="property-list">
                <div>
                  <dt>DDI</dt>
                  <dd>
                    {channel.ddiDisplay} · {ddiName}
                  </dd>
                </div>
                <div>
                  <dt>Machine</dt>
                  <dd>{channel.deviceName ?? "Unresolved"}</dd>
                </div>
                <div>
                  <dt>Device element</dt>
                  <dd>{channel.deviceElementName ?? "Unresolved"}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{timeLog.filename}</dd>
                </div>
              </dl>
            </section>
          </>
        )}
        {inspectorTab === "attributes" && (
          <section className="inspector-section">
            <div className="section-title">
              <span>Record attributes</span>
            </div>
            <dl className="property-list code-list">
              <div>
                <dt>RecordIndex</dt>
                <dd>{recordIndex}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>
                  {Number.isFinite(timestamp)
                    ? new Date(timestamp).toISOString()
                    : "unavailable"}
                </dd>
              </div>
              <div>
                <dt>DLVIndex</dt>
                <dd>{channel.dlvIndex}</dd>
              </div>
              <div>
                <dt>RawValue</dt>
                <dd>{raw ?? "absent"}</dd>
              </div>
              <div>
                <dt>PositionStatus</dt>
                <dd>{timeLog.positionStatus[recordIndex]}</dd>
              </div>
            </dl>
          </section>
        )}
        {inspectorTab === "relationships" && (
          <section className="inspector-section">
            <div className="section-title">
              <span>Evidence chain</span>
            </div>
            <div className="relationship-list">
              {relationships.map(([type, object, description], index) => (
                <div key={`${type}:${object?.uid ?? index}`}>
                  <Link2 size={13} />
                  <span>{type}</span>
                  <p>
                    <strong>{object?.id ?? "unresolved"}</strong>
                    <small>{description}</small>
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        {inspectorTab === "source" && (
          <>
            <section className="inspector-section">
              <div className="section-title">
                <span>Binary record start</span>
              </div>
              <div className="binary-offset">
                <Clock3 size={14} />
                <div>
                  <span>Byte offset {binaryOffset}</span>
                  <small>{timeLog.filename}</small>
                </div>
              </div>
              <pre className="hex-block">
                {hexWindow(binaryBytes, binaryOffset)}
              </pre>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>Companion template</span>
              </div>
              <div className="source-note">
                <Braces size={14} />
                <span>{timeLog.headerFilename}</span>
              </div>
            </section>
          </>
        )}
        {inspectorTab === "validation" && (
          <section className="inspector-section">
            <div className="section-title">
              <span>Time-log validation</span>
              <b>{timeLog.validationIssues.length}</b>
            </div>
            <div className="issue-list">
              {timeLog.validationIssues.length ? (
                timeLog.validationIssues.map((entry) => (
                  <div
                    className={`issue-card ${entry.severity}`}
                    key={entry.id}
                  >
                    <AlertTriangle size={14} />
                    <div>
                      <strong>{entry.code}</strong>
                      <span>{entry.message}</span>
                      <p>{entry.explanation}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="source-note">
                  <CheckCircle2 size={14} />
                  <span>The time log decoded without validation issues.</span>
                </div>
              )}
            </div>
          </section>
        )}
        {inspectorTab === "adapter" && (
          <TimeLogAdapterControl
            timeLog={timeLog}
            onSelectAdapter={onSelectAdapter}
            busy={adapterBusy}
          />
        )}
      </div>
    </aside>
  );
}
