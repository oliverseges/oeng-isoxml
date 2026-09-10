"use client";

import {
    createI18n,
    SUPPORTED_LOCALES,
    type SupportedLocale,
} from "@/lib/client/i18n";
import type { IsoXmlDataset } from "@/lib/isoxml/types";
import {
    Check,
    ChevronDown,
    Download,
    Import,
    Languages,
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
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
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
  locale,
  onLocaleChange,
}: TopBarProps) {
  const i18n = createI18n(locale);
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
    ? i18n.t("counts.errors", { count: errorCount })
    : warningCount
      ? i18n.t("counts.warnings", { count: warningCount })
      : infoCount
        ? i18n.t("counts.notes", { count: infoCount })
        : i18n.t("No issues");
  const menuDatasets =
    dataset && !recentDatasets.some((candidate) => candidate.id === dataset.id)
      ? [dataset, ...recentDatasets]
      : recentDatasets;
  const storedDatasetIds = new Set(
    recentDatasets.map((candidate) => candidate.id),
  );
  const validationTitle = `${i18n.t("Open validation report")} · ${i18n.t(
    "counts.errors",
    { count: errorCount },
  )}, ${i18n.t("counts.warnings", { count: warningCount })}, ${i18n.t(
    "counts.notes",
    { count: infoCount },
  )}`;

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
            <small>{dataset?.sourceLabel ?? i18n.t("Local workspace")}</small>
            <strong>{dataset?.title ?? i18n.t("Preparing dataset…")}</strong>
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
            aria-label={i18n.t("Recent ISOXML datasets")}
          >
            <div className="dataset-menu-heading">
              <span>{i18n.t("Recent datasets").toUpperCase()}</span>
              <div>
                <small>{i18n.t("Up to 10 · stored locally")}</small>
                <button
                  type="button"
                  disabled={!recentDatasets.length}
                  onClick={onClearDatasets}
                  aria-label={i18n.t("Clear all locally stored datasets")}
                  title={i18n.t("Remove all locally stored datasets")}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  {i18n.t("Clear all")}
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
                      {i18n.t("counts.files", { count: candidate.files.length })} ·{" "}
                      {i18n.formatNumber(candidate.memoryBytes / (1024 * 1024), {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })} MiB
                    </small>
                    {isActive && (
                      <Check
                        className="dataset-current-indicator"
                        size={15}
                        aria-label={i18n.t("Current dataset")}
                      />
                    )}
                  </button>
                  {isStored && (
                    <button
                      type="button"
                      className="dataset-delete"
                      onClick={() => onRemoveDataset(candidate.id)}
                      aria-label={i18n.t("Remove {title} from local storage", {
                        title: candidate.title,
                      })}
                      title={i18n.t("Remove from local storage")}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {!recentDatasets.length && (
              <p>{i18n.t("Imported packages will appear here for quick switching.")}</p>
            )}
          </div>
        )}
      </div>

      <div className="topbar-actions">
        <label className="topbar-locale-select">
          <span className="sr-only">{i18n.t("Language")}</span>
          <div className="topbar-locale-field">
            <Languages size={13} aria-hidden="true" />
            <select
              value={locale}
              aria-label={i18n.t("Choose interface language")}
              onChange={(event) =>
                onLocaleChange(event.currentTarget.value as SupportedLocale)
              }
            >
              {SUPPORTED_LOCALES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </div>
        </label>
        <button
          type="button"
          className={`validation-pill ${errorCount ? "has-error" : warningCount ? "has-warning" : ""}`}
          title={validationTitle}
          aria-label={`${i18n.t("Open validation report")}: ${issueLabel}`}
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
          aria-label={i18n.t("Toggle theme")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="secondary-button topbar-button transform-button"
          type="button"
          disabled={!dataset}
          onClick={onTransform}
          aria-label={i18n.t("Create transformed ISOXML package variant")}
          title={i18n.t(
            "Remove or remap content, merge compatible tasks, download, and preview",
          )}
        >
          <Sparkles size={15} aria-hidden="true" />
          <span>{i18n.t("Create variant")}</span>
        </button>
        <label className="primary-button topbar-button import-button">
          <Import size={15} aria-hidden="true" />
          <span>{i18n.t("Import")}</span>
          <input
            className="import-file-input"
            type="file"
            multiple
            accept=".xml,.bin,.zip,.shp,.dbf,.shx,.prj,.cpg,application/zip,application/xml"
            aria-label={i18n.t("Import ISOXML files or a zipped shapefile overlay")}
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
                ? i18n.t("Export selected data channel")
                : (primaryExportAction?.ariaLabel ??
                  i18n.t("Export selected data channel"))
            }
            aria-haspopup={hasExportMenu ? "menu" : undefined}
            aria-expanded={hasExportMenu ? exportMenuOpen : undefined}
            title={
              hasExportMenu
                ? i18n.t("Export active channel")
                : (primaryExportAction?.title ?? i18n.t("Export active channel"))
            }
          >
            <Download size={15} aria-hidden="true" />
            <span>{i18n.t("Export")}</span>
            {hasExportMenu && (
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={exportMenuOpen ? "open" : ""}
              />
            )}
          </button>
          {hasExportMenu && exportMenuOpen && (
            <div
              className="export-menu"
              role="menu"
              aria-label={i18n.t("Export options")}
            >
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
