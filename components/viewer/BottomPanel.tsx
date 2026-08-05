"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Binary,
  Braces,
  ChevronDown,
  CircleX,
  Copy,
  FileStack,
  Grid3X3,
  Info,
  TriangleAlert,
} from "lucide-react";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import type {
  DecodedGrid,
  DecodedTimeLog,
  GridChannel,
  IsoXmlDataset,
  TimeLogChannel,
} from "@/lib/isoxml/types";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import { useViewerStore, type BottomTab } from "./store";

const tabs: Array<{ id: BottomTab; label: string; icon: typeof Grid3X3 }> = [
  { id: "cells", label: "Cell matrix", icon: Grid3X3 },
  { id: "files", label: "Files", icon: FileStack },
  { id: "issues", label: "Issues", icon: AlertCircle },
  { id: "source", label: "Raw source", icon: Braces },
];

const severityRank = {
  error: 0,
  warning: 1,
  info: 2,
} as const;

const severityIcon = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
} as const;

interface BottomPanelProps {
  dataset: IsoXmlDataset;
  grid?: DecodedGrid;
  channel?: GridChannel;
  timeLog?: DecodedTimeLog;
  timeLogChannel?: TimeLogChannel;
}

export function BottomPanel({
  dataset,
  grid,
  channel,
  timeLog,
  timeLogChannel,
}: BottomPanelProps) {
  const bottomTab = useViewerStore((state) => state.bottomTab);
  const bottomAttentionNonce = useViewerStore(
    (state) => state.bottomAttentionNonce,
  );
  const setBottomTab = useViewerStore((state) => state.setBottomTab);
  const setPanelCollapsed = useViewerStore((state) => state.setPanelCollapsed);
  const activeIndex =
    grid?.channels.findIndex(
      (candidate) => candidate.channelId === channel?.channelId,
    ) ?? -1;
  const [expandedIssueId, setExpandedIssueId] = useState<string>();
  const [selectedRawSourceKey, setSelectedRawSourceKey] = useState<string>();
  const attentionClass = bottomAttentionNonce
    ? `attention-${bottomAttentionNonce % 2 ? "odd" : "even"}`
    : "";
  const sortedIssues = useMemo(
    () =>
      dataset.issues
        .map((issue, originalIndex) => ({ issue, originalIndex }))
        .sort(
          (left, right) =>
            severityRank[left.issue.severity] -
              severityRank[right.issue.severity] ||
            left.originalIndex - right.originalIndex,
        )
        .map(({ issue }) => issue),
    [dataset.issues],
  );
  const actionableIssueCount = useMemo(
    () => dataset.issues.filter((issue) => issue.severity !== "info").length,
    [dataset.issues],
  );
  const rawSourceEntries = useMemo(() => {
    const pathCounts = new Map<string, number>();
    const totals = new Map<string, number>();
    const entries = Object.entries(dataset.rawXmlByFile).map(
      ([storageKey, xml]) => {
        const path =
          dataset.files.find(
            (file) => (file.storageKey ?? file.path) === storageKey,
          )?.path ?? storageKey;
        totals.set(path, (totals.get(path) ?? 0) + 1);
        return { storageKey, path, xml };
      },
    );
    return entries.map((entry) => {
      const occurrence = (pathCounts.get(entry.path) ?? 0) + 1;
      pathCounts.set(entry.path, occurrence);
      return {
        ...entry,
        label:
          (totals.get(entry.path) ?? 0) > 1
            ? `${entry.path} · occurrence ${occurrence}`
            : entry.path,
      };
    });
  }, [dataset.files, dataset.rawXmlByFile]);
  const rawSourceEntry =
    rawSourceEntries.find(
      (entry) => entry.storageKey === selectedRawSourceKey,
    ) ?? rawSourceEntries[0];
  const rawSourceFilename = rawSourceEntry?.label ?? "XML source";
  const rawSourceXml = rawSourceEntry?.xml;
  const rawSourceText = rawSourceXml ?? "No XML source available.";
  const rawSourceLineCount = rawSourceText.split(/\r\n|\r|\n/).length;

  return (
    <section
      className={`bottom-panel ${attentionClass}`}
      aria-label="Technical data panel"
      data-attention-cycle={bottomAttentionNonce || undefined}
    >
      <div className="bottom-tabs" role="tablist" aria-label="Data panel views">
        {tabs
          .filter(
            (tab) =>
              tab.id !== "cells" ||
              (grid && channel) ||
              (timeLog && timeLogChannel),
          )
          .map((tab) => {
            const Icon = tab.icon;
            const count =
              tab.id === "cells"
                ? (grid?.decodedCellCount ?? timeLog?.decodedRecordCount)
                : tab.id === "files"
                  ? dataset.files.length
                  : tab.id === "issues"
                    ? actionableIssueCount || undefined
                    : undefined;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={bottomTab === tab.id}
                className={bottomTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setBottomTab(tab.id)}
              >
                <Icon size={13} />
                {tab.id === "cells" && timeLog ? "Records" : tab.label}
                {count !== undefined && <span>{count}</span>}
              </button>
            );
          })}
        <div className="bottom-tab-spacer" />
        {(channel || timeLogChannel) && (
          <div className="bottom-channel-label">
            <span
              className={`layer-swatch ${timeLogChannel ? "executed" : ""}`}
            />
            DDI {channel?.ddiDisplay ?? timeLogChannel?.ddiDisplay} ·{" "}
            {channel?.productName ?? timeLogChannel?.deviceElementName}
          </div>
        )}
        <button
          className="panel-close-button"
          type="button"
          onClick={() => setPanelCollapsed("bottom", true)}
          aria-label="Collapse bottom panel"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="bottom-content">
        {bottomTab === "cells" && grid && channel && (
          <CellMatrix grid={grid} channel={channel} activeIndex={activeIndex} />
        )}
        {bottomTab === "cells" && timeLog && timeLogChannel && (
          <TimeLogMatrix timeLog={timeLog} channel={timeLogChannel} />
        )}
        {bottomTab === "files" && (
          <div className="file-table">
            <div className="technical-table-head file-row">
              <span>Name</span>
              <span>Type</span>
              <span>Size</span>
              <span>Used</span>
              <span>SHA-256</span>
              <span>Status</span>
            </div>
            <div className="technical-scroll">
              {dataset.files.map((file, fileIndex) => (
                <div
                  className="file-row data-row"
                  key={`${file.id}:${fileIndex}`}
                  role="row"
                >
                  <span>
                    <Binary size={13} />
                    {file.path}
                  </span>
                  <span>{file.kind}</span>
                  <span>{file.size.toLocaleString()} B</span>
                  <span>{file.used ? "yes" : "no"}</span>
                  <code>{file.checksum.slice(0, 16)}…</code>
                  <span className={`table-status ${file.validationStatus}`}>
                    {file.validationStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bottomTab === "issues" && (
          <div className="issue-table">
            <div className="technical-table-head issue-row">
              <span>Severity</span>
              <span>Code</span>
              <span>Message</span>
              <span>Source</span>
              <span>Recovery</span>
            </div>
            <div className="technical-scroll">
              {sortedIssues.map((issue, issueIndex) => {
                const issueKey = `${issue.id}:${issueIndex}`;
                const expanded = expandedIssueId === issueKey;
                const SeverityIcon = severityIcon[issue.severity];
                return (
                  <div className="issue-record" key={issueKey}>
                    <button
                      className={`issue-row data-row severity-${issue.severity} ${expanded ? "expanded" : ""}`}
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedIssueId(expanded ? undefined : issueKey)
                      }
                      title="Show explanation and suggested action"
                    >
                      <span className={`severity-text ${issue.severity}`}>
                        <SeverityIcon size={14} aria-hidden="true" />
                        {issue.severity}
                      </span>
                      <code>{issue.code}</code>
                      <span>{issue.message}</span>
                      <span>
                        {issue.filename ?? issue.objectId ?? "dataset"}
                      </span>
                      <span>
                        {issue.recovered ? "Recovered" : "Needs action"}
                      </span>
                    </button>
                    {expanded && (
                      <div className="issue-detail">
                        <div>
                          <small>WHAT THIS MEANS</small>
                          <p>{issue.explanation}</p>
                        </div>
                        <div>
                          <small>SUGGESTED ACTION</small>
                          <p>{issue.suggestedAction}</p>
                        </div>
                        <dl>
                          <div>
                            <dt>Category</dt>
                            <dd>{issue.category}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>
                              {issue.path ??
                                issue.filename ??
                                issue.objectId ??
                                "Dataset"}
                            </dd>
                          </div>
                          <div>
                            <dt>Result impact</dt>
                            <dd>
                              {issue.resultsMayBeIncomplete
                                ? "May be incomplete"
                                : "No known loss"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {bottomTab === "source" && (
          <div className="raw-source-panel">
            <div className="source-toolbar">
              {rawSourceEntries.length > 1 ? (
                <select
                  aria-label="XML source file"
                  value={rawSourceEntry?.storageKey}
                  onChange={(event) =>
                    setSelectedRawSourceKey(event.target.value)
                  }
                >
                  {rawSourceEntries.map((entry) => (
                    <option key={entry.storageKey} value={entry.storageKey}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span title={rawSourceFilename}>{rawSourceFilename}</span>
              )}
              <button
                type="button"
                className="source-copy"
                onClick={() => void copyTextToClipboard(rawSourceXml ?? "")}
              >
                <Copy size={13} /> Copy XML
              </button>
            </div>
            <div className="raw-source-scroll">
              <div className="source-gutter">
                {Array.from({ length: rawSourceLineCount }, (_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <pre>{rawSourceText}</pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TimeLogMatrix({
  timeLog,
  channel,
}: {
  timeLog: DecodedTimeLog;
  channel: TimeLogChannel;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRecordIndex = useViewerStore(
    (state) => state.selectedCellIndex,
  );
  const setSelectedRecord = useViewerStore((state) => state.setSelectedCell);
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  // TanStack Virtual intentionally exposes mutable instance methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: timeLog.decodedRecordCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  return (
    <div
      className="cell-table"
      role="table"
      aria-label="Executed time-log records"
    >
      <div className="cell-table-head" role="row">
        {[
          "Record",
          "Time",
          "Latitude",
          "Longitude",
          "Position",
          "Raw int32",
          "Display value",
          "Unit",
        ].map((header) => (
          <span key={header} role="columnheader">
            {header}
          </span>
        ))}
      </div>
      <div className="cell-table-scroll" ref={scrollRef}>
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const present = Boolean(
              timeLog.valuePresent[channelIndex]?.[index],
            );
            const raw = present
              ? timeLog.rawValues[channelIndex][index]
              : undefined;
            const decoded =
              raw === undefined
                ? undefined
                : decodeValue(raw, channel.presentation);
            const values = [
              index + 1,
              new Date(timeLog.timestamps[index]).toLocaleTimeString(),
              Number.isFinite(timeLog.latitudes[index])
                ? timeLog.latitudes[index].toFixed(7)
                : "—",
              Number.isFinite(timeLog.longitudes[index])
                ? timeLog.longitudes[index].toFixed(7)
                : "—",
              timeLog.validPositions[index]
                ? `Valid · ${timeLog.positionStatus[index]}`
                : "Invalid",
              raw ?? "—",
              decoded?.formattedValue ?? "—",
              channel.unit ?? "—",
            ];
            return (
              <button
                type="button"
                className={`cell-table-row ${index === selectedRecordIndex ? "active" : ""}`}
                key={index}
                onClick={() => setSelectedRecord(index)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                role="row"
              >
                {values.map((value, valueIndex) => (
                  <span key={valueIndex} role="cell">
                    {value}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CellMatrix({
  grid,
  channel,
  activeIndex,
}: {
  grid: DecodedGrid;
  channel: GridChannel;
  activeIndex: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedCellIndex = useViewerStore((state) => state.selectedCellIndex);
  const setSelectedCell = useViewerStore((state) => state.setSelectedCell);
  const rowCount =
    activeIndex < 0
      ? 0
      : Math.min(
          grid.decodedCellCount,
          grid.rawValues[activeIndex]?.length ?? 0,
        );
  // TanStack Virtual intentionally exposes mutable instance methods.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  return (
    <div
      className="cell-table"
      role="table"
      aria-label="Grid channel cell values"
    >
      <div className="cell-table-head" role="row">
        {[
          "Cell",
          "Row",
          "Column",
          "Layout",
          "Raw int32",
          "Display value",
          "Unit",
          "Product",
        ].map((header) => (
          <span key={header} role="columnheader">
            {header}
          </span>
        ))}
      </div>
      <div className="cell-table-scroll" ref={scrollRef}>
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            const raw = grid.rawValues[activeIndex][index];
            const decoded = decodeValue(raw, channel.presentation);
            const values = [
              index,
              Math.floor(index / grid.columns) + 1,
              (index % grid.columns) + 1,
              grid.gridType === 2 ? "Direct" : grid.treatmentZoneCodes[index],
              decoded.rawValue,
              decoded.formattedValue,
              channel.unit ?? "—",
              channel.productName ?? "Unresolved",
            ];
            return (
              <button
                type="button"
                className={`cell-table-row ${index === selectedCellIndex ? "active" : ""}`}
                key={index}
                onClick={() => setSelectedCell(index)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                role="row"
              >
                {values.map((value, valueIndex) => (
                  <span key={valueIndex} role="cell">
                    {value}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
