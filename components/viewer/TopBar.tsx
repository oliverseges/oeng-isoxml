"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Import,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import type { IsoXmlDataset } from "@/lib/isoxml/types";

interface TopBarProps {
  dataset?: IsoXmlDataset;
  recentDatasets: IsoXmlDataset[];
  onSelectDataset: (datasetId: string) => void;
  onRemoveDataset: (datasetId: string) => void;
  onClearDatasets: () => void;
  onImportFiles: (files: FileList | null) => void;
  onTransform: () => void;
  onExport: () => void;
  canExport: boolean;
  onTheme: () => void;
  onValidation: () => void;
  theme: "dark" | "light";
}

export function TopBar({
  dataset,
  recentDatasets,
  onSelectDataset,
  onRemoveDataset,
  onClearDatasets,
  onImportFiles,
  onTransform,
  onExport,
  canExport,
  onTheme,
  onValidation,
  theme,
}: TopBarProps) {
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false);
  const datasetMenuRef = useRef<HTMLDivElement>(null);
  const errorCount =
    dataset?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningCount =
    dataset?.issues.filter((issue) => issue.severity === "warning").length ?? 0;
  const infoCount =
    dataset?.issues.filter((issue) => issue.severity === "info").length ?? 0;
  const issueLabel = errorCount
    ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}`
    : warningCount
      ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
      : infoCount
        ? `${infoCount} ${infoCount === 1 ? "note" : "notes"}`
        : "No issues";
  const menuDatasets =
    dataset && !recentDatasets.some((candidate) => candidate.id === dataset.id)
      ? [dataset, ...recentDatasets]
      : recentDatasets;
  const storedDatasetIds = new Set(
    recentDatasets.map((candidate) => candidate.id),
  );

  useEffect(() => {
    if (!datasetMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!datasetMenuRef.current?.contains(event.target as Node)) {
        setDatasetMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDatasetMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [datasetMenuOpen]);

  return (
    <header className="topbar">
      <div className="brand-lockup" aria-label="OENG ISOXML Studio">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-copy">
          <strong>OENG</strong>
          <span>ISOXML Studio</span>
        </span>
      </div>
      <div className="topbar-divider" />
      <div className="dataset-switcher-wrap" ref={datasetMenuRef}>
        <button
          className="dataset-switcher"
          type="button"
          aria-haspopup="menu"
          aria-expanded={datasetMenuOpen}
          onClick={() => setDatasetMenuOpen((open) => !open)}
        >
          <span>
            <small>{dataset?.sourceLabel ?? "Local workspace"}</small>
            <strong>{dataset?.title ?? "Preparing dataset…"}</strong>
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={datasetMenuOpen ? "open" : ""}
          />
        </button>
        {datasetMenuOpen && (
          <div
            className="dataset-menu"
            role="menu"
            aria-label="Recent ISOXML datasets"
          >
            <div className="dataset-menu-heading">
              <span>RECENT DATASETS</span>
              <div>
                <small>Up to 10 · stored locally</small>
                <button
                  type="button"
                  disabled={!recentDatasets.length}
                  onClick={onClearDatasets}
                  aria-label="Clear all locally stored datasets"
                  title="Remove all locally stored datasets"
                >
                  <Trash2 size={12} aria-hidden="true" />
                  Clear all
                </button>
              </div>
            </div>
            {menuDatasets.map((candidate) => {
              const isStored = storedDatasetIds.has(candidate.id);
              const isActive = candidate.id === dataset?.id;
              return (
                <div
                  className={`dataset-menu-row ${isActive ? "active" : ""}`}
                  role="none"
                  key={candidate.id}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="dataset-menu-select"
                    onClick={() => {
                      onSelectDataset(candidate.id);
                      setDatasetMenuOpen(false);
                    }}
                  >
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{candidate.sourceLabel}</small>
                    </span>
                    <small>
                      {candidate.files.length} files ·{" "}
                      {(candidate.memoryBytes / (1024 * 1024)).toFixed(1)} MiB
                    </small>
                    {isActive && (
                      <Check
                        className="dataset-current-indicator"
                        size={15}
                        aria-label="Current dataset"
                      />
                    )}
                  </button>
                  {isStored && (
                    <button
                      type="button"
                      className="dataset-delete"
                      onClick={() => onRemoveDataset(candidate.id)}
                      aria-label={`Remove ${candidate.title} from local storage`}
                      title="Remove from local storage"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {!recentDatasets.length && (
              <p>Imported packages will appear here for quick switching.</p>
            )}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className={`validation-pill ${errorCount ? "has-error" : warningCount ? "has-warning" : ""}`}
          title={`Open validation report · ${errorCount} errors, ${warningCount} warnings, ${infoCount} notes`}
          aria-label={`Open validation report: ${issueLabel}`}
          onClick={onValidation}
        >
          {errorCount || warningCount ? (
            <ShieldAlert size={14} aria-hidden="true" />
          ) : (
            <ShieldCheck size={14} aria-hidden="true" />
          )}
          <span>{issueLabel}</span>
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={onTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="secondary-button topbar-button transform-button"
          type="button"
          disabled={!dataset}
          onClick={onTransform}
          aria-label="Create transformed ISOXML package variant"
          title="Remove or remap content, merge compatible tasks, download, and preview"
        >
          <Sparkles size={15} aria-hidden="true" />
          <span>Create variant</span>
        </button>
        <label className="primary-button topbar-button import-button">
          <Import size={15} aria-hidden="true" />
          <span>Import</span>
          <input
            className="import-file-input"
            type="file"
            multiple
            accept=".xml,.bin,.zip,application/zip,application/xml"
            aria-label="Import ISOXML files"
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              onImportFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button
          className="icon-button"
          type="button"
          onClick={onExport}
          disabled={!canExport}
          aria-label="Export selected data channel as CSV"
          title="Export active channel as CSV"
        >
          <Download size={16} />
        </button>
      </div>
    </header>
  );
}
