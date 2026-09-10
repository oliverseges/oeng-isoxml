"use client";

import type { IsoXmlDataset } from "@/lib/isoxml/types";
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
import { useEffect, useRef, useState } from "react";

export interface ExportAction {
  id: string;
  label: string;
  description: string;
  ariaLabel: string;
  title: string;
  onSelect: () => void | Promise<void>;
}

interface TopBarProps {
  dataset?: IsoXmlDataset;
  recentDatasets: IsoXmlDataset[];
  onSelectDataset: (datasetId: string) => void;
  onRemoveDataset: (datasetId: string) => void;
  onClearDatasets: () => void;
  onImportFiles: (files: FileList | null) => void;
  onTransform: () => void;
  exportActions: ExportAction[];
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
  exportActions,
  onTheme,
  onValidation,
  theme,
}: TopBarProps) {
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const datasetMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
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
    if (!datasetMenuOpen && !exportMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!datasetMenuRef.current?.contains(target)) {
        setDatasetMenuOpen(false);
      }
      if (!exportMenuRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDatasetMenuOpen(false);
      setExportMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [datasetMenuOpen, exportMenuOpen]);

  const hasExportMenu = exportActions.length > 1;
  const primaryExportAction = exportActions[0];

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
            accept=".xml,.bin,.zip,.shp,.dbf,.shx,.prj,.cpg,application/zip,application/xml"
            aria-label="Import ISOXML files or a zipped shapefile overlay"
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              onImportFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="export-menu-wrap" ref={exportMenuRef}>
          <button
            className="secondary-button topbar-button export-trigger"
            type="button"
            onClick={() => {
              setDatasetMenuOpen(false);
              if (!hasExportMenu) {
                void primaryExportAction?.onSelect();
                return;
              }
              setExportMenuOpen((open) => !open);
            }}
            disabled={!exportActions.length}
            aria-label={
              hasExportMenu
                ? "Export selected data channel"
                : (primaryExportAction?.ariaLabel ??
                  "Export selected data channel")
            }
            aria-haspopup={hasExportMenu ? "menu" : undefined}
            aria-expanded={hasExportMenu ? exportMenuOpen : undefined}
            title={
              hasExportMenu
                ? "Export active channel"
                : (primaryExportAction?.title ?? "Export active channel")
            }
          >
            <Download size={15} aria-hidden="true" />
            <span>Export</span>
            {hasExportMenu && (
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={exportMenuOpen ? "open" : ""}
              />
            )}
          </button>
          {hasExportMenu && exportMenuOpen && (
            <div className="export-menu" role="menu" aria-label="Export options">
              {exportActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportMenuOpen(false);
                    void action.onSelect();
                  }}
                  aria-label={action.ariaLabel}
                  title={action.title}
                >
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
