"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";
import {
  downloadBlob,
  downloadText,
  gridChannelCsv,
  timeLogChannelCsv,
} from "@/lib/isoxml/export";
import {
  applyTimeLogAdapter as applyTimeLogAdapterInWorker,
  importIsoXmlFiles,
  loadSyntheticDemo,
  type ImportProgress,
} from "@/lib/isoxml/import-client";
import {
  createTransformedPackage,
  type PackageTransformPlan,
} from "@/lib/isoxml/package-transform";
import { datasetRepository } from "@/lib/isoxml/repository";
import type { IsoXmlDataset } from "@/lib/isoxml/types";
import { BottomPanel } from "./BottomPanel";
import { DatasetTree } from "./DatasetTree";
import { Inspector } from "./Inspector";
import { MapWorkspace } from "./MapWorkspace";
import { TimeLogInspector } from "./TimeLogInspector";
import { TimeLogAdapterWorkspace } from "./TimeLogAdapterControl";
import { TimeLogMapWorkspace } from "./TimeLogMapWorkspace";
import { currentDataset, useViewerStore } from "./store";
import { TopBar } from "./TopBar";
import { TransformPackageDialog } from "./TransformPackageDialog";

type PanelName = "left" | "right" | "bottom";

export function ViewerApp() {
  const datasetId = useViewerStore((state) => state.datasetId);
  const dataset = currentDataset(datasetId);
  const setDataset = useViewerStore((state) => state.setDataset);
  const selectDataset = useViewerStore((state) => state.selectDataset);
  const recentDatasetIds = useViewerStore((state) => state.recentDatasetIds);
  const replaceRecentDatasetIds = useViewerStore(
    (state) => state.replaceRecentDatasetIds,
  );
  const activeGridInstanceId = useViewerStore(
    (state) => state.activeGridInstanceId,
  );
  const activeChannelId = useViewerStore((state) => state.activeChannelId);
  const activeTimeLogInstanceId = useViewerStore(
    (state) => state.activeTimeLogInstanceId,
  );
  const activeTimeLogChannelId = useViewerStore(
    (state) => state.activeTimeLogChannelId,
  );
  const leftCollapsed = useViewerStore((state) => state.leftCollapsed);
  const rightCollapsed = useViewerStore((state) => state.rightCollapsed);
  const bottomCollapsed = useViewerStore((state) => state.bottomCollapsed);
  const leftWidth = useViewerStore((state) => state.leftWidth);
  const rightWidth = useViewerStore((state) => state.rightWidth);
  const bottomHeight = useViewerStore((state) => state.bottomHeight);
  const setPanelCollapsed = useViewerStore((state) => state.setPanelCollapsed);
  const setPanelSize = useViewerStore((state) => state.setPanelSize);
  const setBottomTab = useViewerStore((state) => state.setBottomTab);
  const setActiveTimeLog = useViewerStore((state) => state.setActiveTimeLog);
  const setActiveTimeLogChannel = useViewerStore(
    (state) => state.setActiveTimeLogChannel,
  );
  const theme = useViewerStore((state) => state.theme);
  const toggleTheme = useViewerStore((state) => state.toggleTheme);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<ImportProgress>();
  const [importError, setImportError] = useState<string>();
  const [pendingZipFiles, setPendingZipFiles] = useState<File[]>();
  const [transformDialogOpen, setTransformDialogOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [adapterBusyId, setAdapterBusyId] = useState<string>();
  const shellRef = useRef<HTMLDivElement>(null);
  const bootstrapStarted = useRef(false);

  const activeGrid = dataset?.grids.find(
    (grid) => grid.instanceId === activeGridInstanceId,
  );
  const activeChannel = activeGrid?.channels.find(
    (channel) => channel.channelId === activeChannelId,
  );
  const activeTimeLog = (dataset?.timeLogs ?? []).find(
    (timeLog) => timeLog.instanceId === activeTimeLogInstanceId,
  );
  const activeTimeLogChannel = activeTimeLog?.channels.find(
    (channel) => channel.channelId === activeTimeLogChannelId,
  );
  const recentDatasets = recentDatasetIds.flatMap((id) => {
    const recentDataset = currentDataset(id);
    return recentDataset ? [recentDataset] : [];
  });

  const applyDataset = useCallback(
    (nextDataset: IsoXmlDataset, remember = true) => {
      setDataset(nextDataset, remember);
      setProgress(undefined);
      setImportError(undefined);
    },
    [setDataset, setImportError, setProgress],
  );

  const selectTimeLogAdapter = async (
    timeLogInstanceId: string,
    adapterId?: string,
  ) => {
    if (!dataset || adapterBusyId) return;
    setAdapterBusyId(timeLogInstanceId);
    setImportError(undefined);
    setProgress({
      stage: "timelogs",
      progress: 0.72,
      detail: adapterId
        ? "Applying selected time-log adapter"
        : "Re-evaluating time-log adapters",
    });
    try {
      const nextDataset = await applyTimeLogAdapterInWorker(
        dataset,
        timeLogInstanceId,
        adapterId,
      );
      applyDataset(nextDataset, true);
      const updatedTimeLog = nextDataset.timeLogs.find(
        (timeLog) => timeLog.instanceId === timeLogInstanceId,
      );
      const firstChannel = updatedTimeLog?.channels[0];
      if (updatedTimeLog && firstChannel) {
        setActiveTimeLogChannel(
          updatedTimeLog.instanceId,
          firstChannel.channelId,
        );
      } else if (updatedTimeLog) {
        setActiveTimeLog(updatedTimeLog.instanceId);
      }
    } catch (error) {
      setProgress(undefined);
      setImportError(
        error instanceof Error
          ? error.message
          : "The time-log adapter could not be applied.",
      );
    } finally {
      setAdapterBusyId(undefined);
    }
  };

  const runImport = async (files: File[], sourceLabel: string) => {
    try {
      setImportError(undefined);
      const nextDataset = await importIsoXmlFiles(
        files,
        sourceLabel,
        setProgress,
      );
      applyDataset(nextDataset, true);
    } catch (error) {
      setProgress(undefined);
      setImportError(error instanceof Error ? error.message : "Import failed.");
    }
  };

  useEffect(() => {
    shellRef.current?.setAttribute("data-interactive", "true");
  }, []);

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 840px)");
    const collapseDrawers = (matches: boolean) => {
      if (!matches) return;
      setPanelCollapsed("left", true);
      setPanelCollapsed("right", true);
    };
    collapseDrawers(compactLayout.matches);
    const onChange = (event: MediaQueryListEvent) =>
      collapseDrawers(event.matches);
    compactLayout.addEventListener("change", onChange);
    return () => compactLayout.removeEventListener("change", onChange);
  }, [setPanelCollapsed]);

  const openPanel = (panel: "left" | "right") => {
    if (window.matchMedia("(max-width: 840px)").matches) {
      setPanelCollapsed(panel === "left" ? "right" : "left", true);
    }
    setPanelCollapsed(panel, false);
  };

  useEffect(() => {
    if (bootstrapStarted.current || dataset) return;
    bootstrapStarted.current = true;
    void (async () => {
      const savedIds = useViewerStore.getState().recentDatasetIds;
      const restoredDatasets = await datasetRepository.restore(savedIds);
      replaceRecentDatasetIds(restoredDatasets.map((item) => item.id));
      if (restoredDatasets.length) {
        selectDataset(restoredDatasets[0].id);
        setProgress(undefined);
        setImportError(undefined);
        return;
      }
      const demoDataset = await loadSyntheticDemo(setProgress);
      applyDataset(demoDataset, false);
    })().catch((error: unknown) => {
      setProgress(undefined);
      setImportError(
        error instanceof Error ? error.message : "Demo import failed.",
      );
    });
  }, [applyDataset, dataset, replaceRecentDatasetIds, selectDataset]);

  useEffect(() => {
    if (!pendingZipFiles) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingZipFiles(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingZipFiles]);

  const onFiles = (files: FileList | null, label: string) => {
    if (!files?.length) return;
    const selectedFiles = [...files];
    const zipFiles = selectedFiles.filter((file) =>
      file.name.toLowerCase().endsWith(".zip"),
    );
    if (zipFiles.length > 1) {
      setPendingZipFiles(selectedFiles);
      return;
    }
    void runImport(
      selectedFiles,
      selectedFiles.length === 1 ? selectedFiles[0].name : label,
    );
  };

  const importZipFilesSeparately = async (files: File[]) => {
    setPendingZipFiles(undefined);
    setImportError(undefined);
    try {
      for (const [index, file] of files.entries()) {
        const nextDataset = await importIsoXmlFiles(
          [file],
          file.name,
          (nextProgress) =>
            setProgress({
              ...nextProgress,
              detail: `${file.name} (${index + 1}/${files.length}) · ${nextProgress.detail}`,
            }),
        );
        setDataset(nextDataset, true);
      }
      setProgress(undefined);
    } catch (error) {
      setProgress(undefined);
      setImportError(
        error instanceof Error ? error.message : "Separate import failed.",
      );
    }
  };

  const removeStoredDataset = async (id: string) => {
    try {
      const remainingIds = recentDatasetIds.filter(
        (candidateId) => candidateId !== id,
      );
      datasetRepository.remove(id);
      replaceRecentDatasetIds(remainingIds);
      if (datasetId !== id) return;

      const nextDatasetId = remainingIds.find((candidateId) =>
        Boolean(currentDataset(candidateId)),
      );
      if (nextDatasetId) {
        selectDataset(nextDatasetId);
        return;
      }

      const demoDataset = await loadSyntheticDemo(setProgress);
      applyDataset(demoDataset, false);
    } catch (error) {
      setProgress(undefined);
      setImportError(
        error instanceof Error
          ? error.message
          : "Fallback dataset failed to load.",
      );
    }
  };

  const clearStoredDatasets = async () => {
    try {
      const currentDatasetWasStored = Boolean(
        datasetId && recentDatasetIds.includes(datasetId),
      );
      datasetRepository.clearStored(recentDatasetIds);
      replaceRecentDatasetIds([]);
      if (!currentDatasetWasStored) return;

      const demoDataset = await loadSyntheticDemo(setProgress);
      applyDataset(demoDataset, false);
    } catch (error) {
      setProgress(undefined);
      setImportError(
        error instanceof Error
          ? error.message
          : "Fallback dataset failed to load.",
      );
    }
  };

  const startResize = (
    panel: PanelName,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize =
      panel === "left"
        ? leftWidth
        : panel === "right"
          ? rightWidth
          : bottomHeight;
    const move = (pointerEvent: PointerEvent) => {
      const delta =
        panel === "left"
          ? pointerEvent.clientX - startX
          : panel === "right"
            ? startX - pointerEvent.clientX
            : startY - pointerEvent.clientY;
      setPanelSize(panel, startSize + delta);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const resizeWithKeyboard = (
    panel: PanelName,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const step = event.shiftKey ? 40 : 10;
    const currentSize =
      panel === "left"
        ? leftWidth
        : panel === "right"
          ? rightWidth
          : bottomHeight;
    const delta =
      panel === "left"
        ? event.key === "ArrowRight"
          ? step
          : event.key === "ArrowLeft"
            ? -step
            : 0
        : panel === "right"
          ? event.key === "ArrowLeft"
            ? step
            : event.key === "ArrowRight"
              ? -step
              : 0
          : event.key === "ArrowUp"
            ? step
            : event.key === "ArrowDown"
              ? -step
              : 0;
    if (!delta) return;
    event.preventDefault();
    setPanelSize(panel, currentSize + delta);
  };

  const exportActive = () => {
    if (!dataset) return;
    if (activeGrid && activeChannel) {
      downloadText(
        gridChannelCsv(activeGrid, activeChannel),
        `${activeGrid.id}-${activeChannel.ddiDisplay}-${activeChannel.productId ?? "channel"}.csv`,
        "text/csv;charset=utf-8",
      );
      return;
    }
    if (activeTimeLog && activeTimeLogChannel) {
      downloadText(
        timeLogChannelCsv(activeTimeLog, activeTimeLogChannel),
        `${activeTimeLog.id}-${activeTimeLogChannel.ddiDisplay}-${activeTimeLogChannel.deviceElementId ?? "channel"}.csv`,
        "text/csv;charset=utf-8",
      );
    }
  };

  const createVariant = async (plan: PackageTransformPlan) => {
    if (!dataset) return;
    try {
      setImportError(undefined);
      const transformed = await createTransformedPackage(dataset, plan);
      setTransformDialogOpen(false);
      const nextDataset = await importIsoXmlFiles(
        [transformed.file],
        `${plan.variantName.trim()} · transformed`,
        setProgress,
      );
      nextDataset.title = plan.variantName.trim();
      nextDataset.sourceLabel = `${transformed.file.name} · transformed from ${dataset.sourceLabel}`;
      const currentRecentIds = useViewerStore.getState().recentDatasetIds;
      if (!currentRecentIds.includes(dataset.id)) {
        replaceRecentDatasetIds([dataset.id, ...currentRecentIds].slice(0, 10));
        void datasetRepository.persist(dataset);
      }
      downloadBlob(transformed.file, transformed.file.name);
      applyDataset(nextDataset, true);
    } catch (error) {
      setProgress(undefined);
      setImportError(
        error instanceof Error
          ? error.message
          : "The package variant could not be created.",
      );
    }
  };

  const shellStyle = {
    "--left-width": leftCollapsed ? "0px" : `${leftWidth}px`,
    "--right-width": rightCollapsed ? "0px" : `${rightWidth}px`,
    "--bottom-height": bottomCollapsed ? "0px" : `${bottomHeight}px`,
    "--left-divider": leftCollapsed ? "0px" : "4px",
    "--right-divider": rightCollapsed ? "0px" : "4px",
    "--bottom-divider": bottomCollapsed ? "0px" : "4px",
  } as CSSProperties;

  return (
    <div
      ref={shellRef}
      className={`viewer-shell ${theme}`}
      data-interactive="false"
      style={shellStyle}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        onFiles(event.dataTransfer.files, "Dropped ISOXML package");
      }}
    >
      <TopBar
        dataset={dataset}
        recentDatasets={recentDatasets}
        onSelectDataset={selectDataset}
        onRemoveDataset={(id) => void removeStoredDataset(id)}
        onClearDatasets={() => void clearStoredDatasets()}
        onImportFiles={(files) => onFiles(files, "Selected ISOXML files")}
        onTransform={() => setTransformDialogOpen(true)}
        onExport={exportActive}
        canExport={Boolean(
          dataset &&
          ((activeGrid && activeChannel) ||
            (activeTimeLog && activeTimeLogChannel)),
        )}
        onTheme={toggleTheme}
        onValidation={() => setBottomTab("issues")}
        theme={theme}
      />
      <div className="workspace-body">
        {!leftCollapsed && dataset && (
          <DatasetTree
            key={dataset.id}
            dataset={dataset}
            search={search}
            onSearchChange={setSearch}
          />
        )}
        <div
          className="resize-divider vertical"
          onPointerDown={(event) => startResize("left", event)}
          onKeyDown={(event) => resizeWithKeyboard("left", event)}
          role="separator"
          aria-label="Resize dataset navigator"
          aria-orientation="vertical"
          aria-valuemin={240}
          aria-valuemax={480}
          aria-valuenow={leftWidth}
          tabIndex={0}
        />
        <div className="center-stack">
          {dataset && activeGrid && activeChannel ? (
            <MapWorkspace
              dataset={dataset}
              grid={activeGrid}
              channel={activeChannel}
            />
          ) : dataset &&
            activeTimeLog &&
            activeTimeLog.adapterSelection.mode === "unresolved" ? (
            <TimeLogAdapterWorkspace
              timeLog={activeTimeLog}
              onSelectAdapter={(adapterId) =>
                void selectTimeLogAdapter(activeTimeLog.instanceId, adapterId)
              }
              busy={adapterBusyId === activeTimeLog.instanceId}
            />
          ) : dataset && activeTimeLog && activeTimeLogChannel ? (
            <TimeLogMapWorkspace
              key={activeTimeLog.instanceId}
              dataset={dataset}
              timeLog={activeTimeLog}
              channel={activeTimeLogChannel}
            />
          ) : dataset && activeTimeLog ? (
            <TimeLogAdapterWorkspace
              timeLog={activeTimeLog}
              onSelectAdapter={(adapterId) =>
                void selectTimeLogAdapter(activeTimeLog.instanceId, adapterId)
              }
              busy={adapterBusyId === activeTimeLog.instanceId}
            />
          ) : dataset ? (
            <div className="workspace-loading workspace-empty">
              <DatabaseZap size={30} />
              <strong>No decoded spatial channel is available</strong>
              <span>
                The package is still preserved. Review its issues, files, and
                raw XML for unsupported or incomplete data.
              </span>
              <div className="workspace-empty-actions">
                <button type="button" onClick={() => setBottomTab("issues")}>
                  Open issues
                </button>
                <button type="button" onClick={() => setBottomTab("files")}>
                  Open files
                </button>
                <button type="button" onClick={() => setBottomTab("source")}>
                  Open XML
                </button>
              </div>
            </div>
          ) : (
            <div className="workspace-loading">
              <DatabaseZap size={30} />
              <strong>Preparing the engineering workspace</strong>
              <span>
                Lossless XML, references and binary layers will appear here.
              </span>
            </div>
          )}
          <div
            className="resize-divider horizontal"
            onPointerDown={(event) => startResize("bottom", event)}
            onKeyDown={(event) => resizeWithKeyboard("bottom", event)}
            role="separator"
            aria-label="Resize technical data panel"
            aria-orientation="horizontal"
            aria-valuemin={150}
            aria-valuemax={420}
            aria-valuenow={bottomHeight}
            tabIndex={0}
          />
          {!bottomCollapsed && dataset && (
            <BottomPanel
              dataset={dataset}
              grid={activeGrid}
              channel={activeChannel}
              timeLog={activeTimeLog}
              timeLogChannel={activeTimeLogChannel}
            />
          )}
          {bottomCollapsed && (
            <button
              className="collapsed-bottom-toggle"
              type="button"
              onClick={() => setPanelCollapsed("bottom", false)}
            >
              <ChevronLeft size={13} />
              OPEN DATA PANEL
            </button>
          )}
        </div>
        <div
          className="resize-divider vertical"
          onPointerDown={(event) => startResize("right", event)}
          onKeyDown={(event) => resizeWithKeyboard("right", event)}
          role="separator"
          aria-label="Resize object inspector"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={520}
          aria-valuenow={rightWidth}
          tabIndex={0}
        />
        {!rightCollapsed && dataset && activeGrid && activeChannel && (
          <Inspector
            dataset={dataset}
            grid={activeGrid}
            channel={activeChannel}
          />
        )}
        {!rightCollapsed &&
          dataset &&
          activeTimeLog &&
          activeTimeLogChannel && (
            <TimeLogInspector
              dataset={dataset}
              timeLog={activeTimeLog}
              channel={activeTimeLogChannel}
              onSelectAdapter={(adapterId) =>
                void selectTimeLogAdapter(activeTimeLog.instanceId, adapterId)
              }
              adapterBusy={adapterBusyId === activeTimeLog.instanceId}
            />
          )}
      </div>

      {leftCollapsed && (
        <button
          type="button"
          className="collapsed-panel-toggle left"
          onClick={() => openPanel("left")}
          aria-label="Open dataset navigator"
        >
          <ChevronRight size={15} />
        </button>
      )}
      {!leftCollapsed && (
        <button
          type="button"
          className="panel-collapse-control left"
          onClick={() => setPanelCollapsed("left", true)}
          aria-label="Collapse dataset navigator"
        >
          <ChevronLeft size={13} />
        </button>
      )}
      {rightCollapsed && (
        <button
          type="button"
          className="collapsed-panel-toggle right"
          onClick={() => openPanel("right")}
          aria-label="Open object inspector"
        >
          <ChevronLeft size={15} />
        </button>
      )}
      {!rightCollapsed && (
        <button
          type="button"
          className="panel-collapse-control right"
          onClick={() => setPanelCollapsed("right", true)}
          aria-label="Collapse object inspector"
        >
          <ChevronRight size={13} />
        </button>
      )}

      {transformDialogOpen && dataset && (
        <TransformPackageDialog
          dataset={dataset}
          onCancel={() => setTransformDialogOpen(false)}
          onCreate={createVariant}
        />
      )}

      {pendingZipFiles && (
        <div className="multi-import-overlay">
          <section
            className="multi-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="multi-import-title"
          >
            <small>MULTIPLE ZIP PACKAGES</small>
            <h2 id="multi-import-title">
              How should {pendingZipFiles.length} packages be imported?
            </h2>
            <p>
              Separate imports remain available in Recent datasets. Combining
              preserves every selected file in one workspace; it does not
              rewrite their ISOXML relationships.
            </p>
            <ul>
              {pendingZipFiles.map((file) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span>{file.name}</span>
                  <small>{(file.size / (1024 * 1024)).toFixed(1)} MiB</small>
                </li>
              ))}
            </ul>
            <div className="multi-import-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingZipFiles(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const files = pendingZipFiles;
                  setPendingZipFiles(undefined);
                  void runImport(
                    files,
                    `Merged ${files.length} ISOXML packages`,
                  );
                }}
              >
                Combine in one workspace
              </button>
              <button
                type="button"
                className="primary-button"
                autoFocus
                onClick={() => void importZipFilesSeparately(pendingZipFiles)}
              >
                Import separately
              </button>
            </div>
          </section>
        </div>
      )}

      {(progress || dragActive) && (
        <div className={`import-overlay ${dragActive ? "dragging" : ""}`}>
          <div className="import-dialog">
            {dragActive ? (
              <UploadCloud size={30} />
            ) : (
              <LoaderCircle size={30} className="spin" />
            )}
            <small>
              {dragActive ? "LOCAL IMPORT" : progress?.stage.toUpperCase()}
            </small>
            <strong>
              {dragActive ? "Drop the ISOXML package here" : progress?.detail}
            </strong>
            {!dragActive && (
              <>
                <div className="progress-track">
                  <span
                    style={{ width: `${(progress?.progress ?? 0) * 100}%` }}
                  />
                </div>
                <p>Files are processed locally and are never uploaded.</p>
              </>
            )}
          </div>
        </div>
      )}

      {importError && (
        <div className="error-toast" role="alert">
          <div>
            <small>IMPORT STOPPED</small>
            <strong>{importError}</strong>
          </div>
          <button type="button" onClick={() => setImportError(undefined)}>
            DISMISS
          </button>
        </div>
      )}
    </div>
  );
}
