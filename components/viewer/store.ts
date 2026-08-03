"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { datasetRepository } from "@/lib/isoxml/repository";
import type { IsoXmlDataset } from "@/lib/isoxml/types";

export type BottomTab = "cells" | "files" | "issues" | "source";
export type InspectorTab =
  "overview" | "attributes" | "relationships" | "source" | "validation";

interface ViewerState {
  datasetId?: string;
  recentDatasetIds: string[];
  activeTaskId?: string;
  activeGridInstanceId?: string;
  activeChannelId?: string;
  selectedCellIndex?: number;
  hoveredCellIndex?: number;
  bottomTab: BottomTab;
  bottomAttentionNonce: number;
  inspectorTab: InspectorTab;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  baseLayer: "none" | "streets" | "satellite";
  hideEmptyCells: boolean;
  hideOutliers: boolean;
  clipToField: boolean;
  mapFitNonce: number;
  theme: "dark" | "light";
  setDataset: (dataset: IsoXmlDataset, remember?: boolean) => void;
  selectDataset: (datasetId: string) => void;
  replaceRecentDatasetIds: (datasetIds: string[]) => void;
  setActiveChannel: (gridInstanceId: string, channelId: string) => void;
  setSelectedCell: (cellIndex: number | undefined) => void;
  setHoveredCell: (cellIndex: number | undefined) => void;
  setBottomTab: (tab: BottomTab) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setPanelCollapsed: (
    panel: "left" | "right" | "bottom",
    collapsed: boolean,
  ) => void;
  setPanelSize: (panel: "left" | "right" | "bottom", size: number) => void;
  setBaseLayer: (baseLayer: "none" | "streets" | "satellite") => void;
  setHideEmptyCells: (hideEmptyCells: boolean) => void;
  setHideOutliers: (hideOutliers: boolean) => void;
  setClipToField: (clipToField: boolean) => void;
  requestMapFit: () => void;
  toggleTheme: () => void;
}

function initialCellIndex(dataset: IsoXmlDataset): number | undefined {
  const decodedCellCount = dataset.grids[0]?.decodedCellCount ?? 0;
  return decodedCellCount > 0 ? Math.min(18, decodedCellCount - 1) : undefined;
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set) => ({
      recentDatasetIds: [],
      bottomTab: "cells",
      bottomAttentionNonce: 0,
      inspectorTab: "overview",
      leftCollapsed: false,
      rightCollapsed: false,
      bottomCollapsed: false,
      leftWidth: 304,
      rightWidth: 344,
      bottomHeight: 212,
      baseLayer: "none",
      hideEmptyCells: true,
      hideOutliers: false,
      clipToField: false,
      mapFitNonce: 0,
      theme: "dark",
      setDataset: (dataset, remember = true) => {
        datasetRepository.put(dataset);
        const firstGrid = dataset.grids[0];
        set((state) => ({
          datasetId: dataset.id,
          recentDatasetIds: remember
            ? [
                dataset.id,
                ...state.recentDatasetIds.filter((id) => id !== dataset.id),
              ].slice(0, 10)
            : state.recentDatasetIds,
          activeTaskId: dataset.tasks[0]?.id,
          activeGridInstanceId: firstGrid?.instanceId,
          activeChannelId: firstGrid?.channels[0]?.channelId,
          selectedCellIndex: initialCellIndex(dataset),
          hoveredCellIndex: undefined,
          bottomTab: firstGrid?.channels.length
            ? state.bottomTab
            : dataset.issues.length
              ? "issues"
              : "files",
        }));
        if (remember) void datasetRepository.persist(dataset);
      },
      selectDataset: (datasetId) => {
        const dataset = datasetRepository.get(datasetId);
        if (!dataset) return;
        const firstGrid = dataset.grids[0];
        set({
          datasetId,
          activeTaskId: dataset.tasks[0]?.id,
          activeGridInstanceId: firstGrid?.instanceId,
          activeChannelId: firstGrid?.channels[0]?.channelId,
          selectedCellIndex: initialCellIndex(dataset),
          hoveredCellIndex: undefined,
          bottomTab: firstGrid?.channels.length
            ? "cells"
            : dataset.issues.length
              ? "issues"
              : "files",
        });
      },
      replaceRecentDatasetIds: (recentDatasetIds) =>
        set({ recentDatasetIds: recentDatasetIds.slice(0, 10) }),
      setActiveChannel: (gridInstanceId, channelId) =>
        set((state) => ({
          activeGridInstanceId: gridInstanceId,
          activeChannelId: channelId,
          selectedCellIndex: undefined,
          bottomTab: "cells",
          bottomCollapsed: false,
          bottomAttentionNonce: state.bottomAttentionNonce + 1,
        })),
      setSelectedCell: (selectedCellIndex) => set({ selectedCellIndex }),
      setHoveredCell: (hoveredCellIndex) => set({ hoveredCellIndex }),
      setBottomTab: (bottomTab) =>
        set((state) => ({
          bottomTab,
          bottomCollapsed: false,
          bottomAttentionNonce: state.bottomAttentionNonce + 1,
        })),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setPanelCollapsed: (panel, collapsed) =>
        set((state) =>
          panel === "left"
            ? { leftCollapsed: collapsed }
            : panel === "right"
              ? { rightCollapsed: collapsed }
              : {
                  bottomCollapsed: collapsed,
                  bottomAttentionNonce: collapsed
                    ? state.bottomAttentionNonce
                    : state.bottomAttentionNonce + 1,
                },
        ),
      setPanelSize: (panel, size) =>
        set(
          panel === "left"
            ? { leftWidth: Math.min(480, Math.max(240, size)) }
            : panel === "right"
              ? { rightWidth: Math.min(520, Math.max(280, size)) }
              : { bottomHeight: Math.min(420, Math.max(150, size)) },
        ),
      setBaseLayer: (baseLayer) => set({ baseLayer }),
      setHideEmptyCells: (hideEmptyCells) => set({ hideEmptyCells }),
      setHideOutliers: (hideOutliers) => set({ hideOutliers }),
      setClipToField: (clipToField) => set({ clipToField }),
      requestMapFit: () =>
        set((state) => ({ mapFitNonce: state.mapFitNonce + 1 })),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
    }),
    {
      name: "oeng-isoxml-viewer-preferences",
      partialize: (state) => ({
        recentDatasetIds: state.recentDatasetIds,
        leftCollapsed: state.leftCollapsed,
        rightCollapsed: state.rightCollapsed,
        bottomCollapsed: state.bottomCollapsed,
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth,
        bottomHeight: state.bottomHeight,
        baseLayer: state.baseLayer,
        hideEmptyCells: state.hideEmptyCells,
        hideOutliers: state.hideOutliers,
        clipToField: state.clipToField,
        theme: state.theme,
      }),
    },
  ),
);

export function currentDataset(
  datasetId: string | undefined,
): IsoXmlDataset | undefined {
  return datasetRepository.get(datasetId);
}
