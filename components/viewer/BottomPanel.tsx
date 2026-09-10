"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { createI18n } from "@/lib/client/i18n";
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

interface MatrixColumnDefinition {
  labelKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

const timeLogMatrixColumns: MatrixColumnDefinition[] = [
  { labelKey: "Record", defaultWidth: 62, minWidth: 52, maxWidth: 110 },
  { labelKey: "Time", defaultWidth: 82, minWidth: 68, maxWidth: 130 },
  { labelKey: "Latitude", defaultWidth: 96, minWidth: 76, maxWidth: 140 },
  { labelKey: "Longitude", defaultWidth: 96, minWidth: 78, maxWidth: 140 },
  { labelKey: "Position", defaultWidth: 92, minWidth: 72, maxWidth: 140 },
  { labelKey: "Raw int32", defaultWidth: 100, minWidth: 82, maxWidth: 150 },
  { labelKey: "Display value", defaultWidth: 112, minWidth: 92, maxWidth: 170 },
  { labelKey: "Unit", defaultWidth: 78, minWidth: 58, maxWidth: 120 },
];

const gridMatrixColumns: MatrixColumnDefinition[] = [
  { labelKey: "Cell", defaultWidth: 60, minWidth: 50, maxWidth: 100 },
  { labelKey: "Row", defaultWidth: 52, minWidth: 44, maxWidth: 90 },
  { labelKey: "Column", defaultWidth: 66, minWidth: 56, maxWidth: 110 },
  { labelKey: "Layout", defaultWidth: 70, minWidth: 58, maxWidth: 120 },
  { labelKey: "Raw int32", defaultWidth: 100, minWidth: 82, maxWidth: 150 },
  { labelKey: "Display value", defaultWidth: 112, minWidth: 92, maxWidth: 170 },
  { labelKey: "Unit", defaultWidth: 78, minWidth: 58, maxWidth: 120 },
  { labelKey: "Product", defaultWidth: 190, minWidth: 110, maxWidth: 360 },
];

function clampedColumnWidth(
  column: MatrixColumnDefinition,
  width: number,
): number {
  return Math.min(column.maxWidth, Math.max(column.minWidth, width));
}

function useResizableMatrixColumns(columns: MatrixColumnDefinition[]) {
  const [widths, setWidths] = useState(() =>
    columns.map((column) => column.defaultWidth),
  );
  const dragCleanupRef = useRef<() => void>(() => {});

  useEffect(
    () => () => {
      dragCleanupRef.current();
    },
    [],
  );

  const setColumnWidth = useCallback(
    (index: number, width: number) => {
      setWidths((current) => {
        const nextWidth = clampedColumnWidth(columns[index], width);
        if (current[index] === nextWidth) return current;
        const next = [...current];
        next[index] = nextWidth;
        return next;
      });
    },
    [columns],
  );

  const beginColumnResize = useCallback(
    (index: number, clientX: number) => {
      dragCleanupRef.current();
      const startWidth = widths[index];
      const move = (event: PointerEvent) => {
        setColumnWidth(index, startWidth + event.clientX - clientX);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        document.body.classList.remove("resizing-table-column");
        dragCleanupRef.current = () => {};
      };
      dragCleanupRef.current = cleanup;
      document.body.classList.add("resizing-table-column");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [setColumnWidth, widths],
  );

  const resetColumnWidth = useCallback(
    (index: number) => setColumnWidth(index, columns[index].defaultWidth),
    [columns, setColumnWidth],
  );
  const gridTemplateColumns = useMemo(
    () => `${widths.map((width) => `${width}px`).join(" ")} minmax(0, 1fr)`,
    [widths],
  );
  const minimumTableWidth = widths.reduce((total, width) => total + width, 0);

  return {
    widths,
    gridTemplateColumns,
    minimumTableWidth,
    beginColumnResize,
    resetColumnWidth,
    setColumnWidth,
  };
}

function ResizableMatrixHeader({
  columns,
  widths,
  gridTemplateColumns,
  beginColumnResize,
  resetColumnWidth,
  setColumnWidth,
  translateLabel,
}: {
  columns: MatrixColumnDefinition[];
  widths: number[];
  gridTemplateColumns: string;
  beginColumnResize: (index: number, clientX: number) => void;
  resetColumnWidth: (index: number) => void;
  setColumnWidth: (index: number, width: number) => void;
  translateLabel: (labelKey: string) => string;
}) {
  return (
    <div className="cell-table-head" role="row" style={{ gridTemplateColumns }}>
      {columns.map((column, index) => {
        const label = translateLabel(column.labelKey);
        return (
        <span key={column.labelKey} role="columnheader">
          {label}
          <i
            className="cell-column-resizer"
            role="separator"
            aria-label={translateLabel("Resize {column} column").replace("{column}", label)}
            aria-orientation="vertical"
            aria-valuemin={column.minWidth}
            aria-valuemax={column.maxWidth}
            aria-valuenow={widths[index]}
            tabIndex={0}
            title={translateLabel("Drag to resize · Double-click to reset")}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              beginColumnResize(index, event.clientX);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetColumnWidth(index);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              setColumnWidth(
                index,
                widths[index] + (event.key === "ArrowRight" ? 8 : -8),
              );
            }}
          />
        </span>
      );})}
    </div>
  );
}

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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
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
            ? `${entry.path} · ${i18n.t("Occurrence {count}", { count: occurrence })}`
            : entry.path,
      };
    });
  }, [dataset.files, dataset.rawXmlByFile, i18n]);
  const rawSourceEntry =
    rawSourceEntries.find(
      (entry) => entry.storageKey === selectedRawSourceKey,
    ) ?? rawSourceEntries[0];
  const rawSourceFilename = rawSourceEntry?.label ?? i18n.t("XML source");
  const rawSourceXml = rawSourceEntry?.xml;
  const rawSourceText = rawSourceXml ?? i18n.t("No XML source available.");
  const rawSourceLineCount = rawSourceText.split(/\r\n|\r|\n/).length;

  return (
    <section
      className={`bottom-panel ${attentionClass}`}
      aria-label={i18n.t("Technical data panel")}
      data-attention-cycle={bottomAttentionNonce || undefined}
    >
      <div className="bottom-tabs" role="tablist" aria-label={i18n.t("Data panel views")}>
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
                {tab.id === "cells" && timeLog ? i18n.t("Records") : i18n.t(tab.label)}
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
          aria-label={i18n.t("Collapse bottom panel")}
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
              <span>{i18n.t("Name")}</span>
              <span>{i18n.t("Type")}</span>
              <span>{i18n.t("Size")}</span>
              <span>{i18n.t("Used")}</span>
              <span>SHA-256</span>
              <span>{i18n.t("Status")}</span>
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
                  <span>{i18n.formatFileSize(file.size)}</span>
                  <span>{file.used ? i18n.t("Yes") : i18n.t("No")}</span>
                  <code>{file.checksum.slice(0, 16)}…</code>
                  <span className={`table-status ${file.validationStatus}`}>
                    {i18n.t(file.validationStatus)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bottomTab === "issues" && (
          <div className="issue-table">
            <div className="technical-table-head issue-row">
              <span>{i18n.t("Severity")}</span>
              <span>{i18n.t("Code")}</span>
              <span>{i18n.t("Message")}</span>
              <span>{i18n.t("Source")}</span>
              <span>{i18n.t("Recovery")}</span>
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
                      title={i18n.t("Show explanation and suggested action")}
                    >
                      <span className={`severity-text ${issue.severity}`}>
                        <SeverityIcon size={14} aria-hidden="true" />
                        {i18n.t(issue.severity)}
                      </span>
                      <code>{issue.code}</code>
                      <span>{issue.message}</span>
                      <span>
                        {issue.filename ?? issue.objectId ?? i18n.t("dataset")}
                      </span>
                      <span>
                        {issue.recovered ? i18n.t("Recovered") : i18n.t("Needs action")}
                      </span>
                    </button>
                    {expanded && (
                      <div className="issue-detail">
                        <div>
                          <small>{i18n.t("What this means").toUpperCase()}</small>
                          <p>{issue.explanation}</p>
                        </div>
                        <div>
                          <small>{i18n.t("Suggested action").toUpperCase()}</small>
                          <p>{issue.suggestedAction}</p>
                        </div>
                        <dl>
                          <div>
                            <dt>{i18n.t("Category")}</dt>
                            <dd>{issue.category}</dd>
                          </div>
                          <div>
                            <dt>{i18n.t("Source")}</dt>
                            <dd>
                              {issue.path ??
                                issue.filename ??
                                issue.objectId ??
                                i18n.t("Dataset")}
                            </dd>
                          </div>
                          <div>
                            <dt>{i18n.t("Result impact")}</dt>
                            <dd>
                              {issue.resultsMayBeIncomplete
                                ? i18n.t("May be incomplete")
                                : i18n.t("No known loss")}
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
                  aria-label={i18n.t("XML source file")}
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
                <Copy size={13} /> {i18n.t("Copy XML")}
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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRecordIndex = useViewerStore(
    (state) => state.selectedCellIndex,
  );
  const setSelectedRecord = useViewerStore((state) => state.setSelectedCell);
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const columns = useResizableMatrixColumns(timeLogMatrixColumns);
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
      aria-label={i18n.t("Executed time-log records")}
    >
      <div className="cell-table-scroll" ref={scrollRef}>
        <div
          className="cell-table-width"
          style={{ minWidth: columns.minimumTableWidth }}
        >
          <ResizableMatrixHeader
            columns={timeLogMatrixColumns}
            translateLabel={i18n.t}
            {...columns}
          />
          <div
            className="cell-table-virtual-body"
            style={{ height: virtualizer.getTotalSize() }}
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
                i18n.formatTime(timeLog.timestamps[index]),
                Number.isFinite(timeLog.latitudes[index])
                  ? timeLog.latitudes[index].toFixed(7)
                  : "—",
                Number.isFinite(timeLog.longitudes[index])
                  ? timeLog.longitudes[index].toFixed(7)
                  : "—",
                timeLog.validPositions[index]
                  ? `${i18n.t("Valid")} · ${timeLog.positionStatus[index]}`
                  : i18n.t("Invalid"),
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
                  style={{
                    gridTemplateColumns: columns.gridTemplateColumns,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
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
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
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
  const columns = useResizableMatrixColumns(gridMatrixColumns);
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
      aria-label={i18n.t("Grid channel cell values")}
    >
      <div className="cell-table-scroll" ref={scrollRef}>
        <div
          className="cell-table-width"
          style={{ minWidth: columns.minimumTableWidth }}
        >
          <ResizableMatrixHeader
            columns={gridMatrixColumns}
            translateLabel={i18n.t}
            {...columns}
          />
          <div
            className="cell-table-virtual-body"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const raw = grid.rawValues[activeIndex][index];
              const decoded = decodeValue(raw, channel.presentation);
              const values = [
                index,
                Math.floor(index / grid.columns) + 1,
                (index % grid.columns) + 1,
                grid.gridType === 2 ? i18n.t("Direct") : grid.treatmentZoneCodes[index],
                decoded.rawValue,
                decoded.formattedValue,
                channel.unit ?? "—",
                channel.productName ?? i18n.t("Unresolved"),
              ];
              return (
                <button
                  type="button"
                  className={`cell-table-row ${index === selectedCellIndex ? "active" : ""}`}
                  key={index}
                  onClick={() => setSelectedCell(index)}
                  style={{
                    gridTemplateColumns: columns.gridTemplateColumns,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
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
    </div>
  );
}
