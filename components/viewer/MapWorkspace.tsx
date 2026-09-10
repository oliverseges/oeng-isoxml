"use client";

import { copyTextToClipboard } from "@/lib/client/clipboard";
import { createI18n, type I18n } from "@/lib/client/i18n";
import { calculateDoseStatistics } from "@/lib/isoxml/dose-statistics";
import { downloadBlob } from "@/lib/isoxml/export";
import { buildMapChannelValues } from "@/lib/isoxml/map-channel-model";
import {
    geographicCellBounds,
    geographicCellCenter,
  polylineDistanceMeters,
    geographicGridBounds,
    gridCellAreaSquareMeters,
    gridCellDimensionsMeters,
    gridCellIndexAt,
    gridCellRangeForBounds,
    isSpatialGridValid,
    pointIsInsideBoundary,
} from "@/lib/isoxml/spatial";
import type {
    DecodedGrid,
    GridChannel,
    IsoXmlDataset,
    SpatialBoundary,
} from "@/lib/isoxml/types";
import {
    classIndexForValue,
    classifyValues,
    type ValueClassification,
} from "@/lib/isoxml/value-classification";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import {
    AlertTriangle,
    Check,
    Crop,
    Crosshair,
    EyeOff,
    Filter,
    Layers,
    LocateFixed,
    MapPin,
    Minus,
    Plus,
    Ruler,
    Scan,
    ScanLine,
    SlidersHorizontal,
    X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BASEMAP_ZOOM_OPTIONS,
    MAP_MAX_ZOOM,
    MAP_MIN_ZOOM,
} from "./map-options";
import {
  drawMeasurementOverlay,
  formatMeasurementDistance,
  type MeasurementPoint,
} from "./map-measurement";
import { buildMapGridRaster, type MapGridRaster } from "./map-rendering";
import { drawMapScreenshotTooltip } from "./map-screenshot";
import { useViewerStore } from "./store";

const colorStops = [
  "#233f52",
  "#27696a",
  "#3c8c6e",
  "#7aaa65",
  "#c5c85b",
  "#f0b64b",
  "#e67c36",
];
const ZOOM_STEP = 0.25;
const MAX_PAINTED_CELL_BLOCKS = 60_000;

function formatCellArea(area: number): string {
  if (area >= 100) return Math.round(area).toString();
  if (area >= 10) return area.toFixed(1).replace(/\.0$/, "");
  return area.toFixed(2).replace(/\.?0+$/, "");
}

function formatCellLength(length: number): string {
  if (length >= 10) return length.toFixed(1).replace(/\.0$/, "");
  return length.toFixed(2).replace(/\.?0+$/, "");
}

function formatMapStatistic(
  value: number,
  preferredDecimals: number,
  locale: string,
): string {
  const decimals = Math.min(4, Math.max(0, preferredDecimals));
  return value.toLocaleString(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.min(2, decimals),
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function interpolatedColor(ratio: number): string {
  const scaled = ratio * (colorStops.length - 1);
  const index = Math.min(colorStops.length - 2, Math.floor(scaled));
  const t = scaled - index;
  const left = hexToRgb(colorStops[index]);
  const right = hexToRgb(colorStops[index + 1]);
  return `rgb(${left.map((component, part) => Math.round(component + (right[part] - component) * t)).join(",")})`;
}

function colorsForClasses(classCount: number): string[] {
  if (classCount <= 0) return [];
  if (classCount === 1) return [interpolatedColor(0.5)];
  return Array.from({ length: classCount }, (_, index) =>
    interpolatedColor(index / (classCount - 1)),
  );
}

function colorFor(
  value: number,
  classification: ValueClassification,
  classColors: readonly string[],
): string {
  const classIndex = classIndexForValue(value, classification);
  return classIndex === undefined ? "#3c4541" : classColors[classIndex];
}

function scaleDescription(
  classification: ValueClassification,
  i18n: I18n,
): string {
  if (!classification.classCount) return i18n.t("No numeric values");
  return `${
    classification.mode === "distinct-values"
      ? i18n.t("Distinct values")
      : i18n.t("Equal interval")
  } · ${i18n.formatInteger(classification.classCount)} ${i18n.t(
    classification.classCount === 1 ? "class" : "classes",
  )}`;
}

function fieldBoundaryForGrid(
  dataset: IsoXmlDataset,
  grid: DecodedGrid,
  activeBoundaryId?: string,
): SpatialBoundary | undefined {
  const task = dataset.tasks.find(
    (candidate) => candidate.instanceId === grid.taskInstanceId,
  );
  const taskObject = task
    ? dataset.objects.find((object) => object.uid === task.objectUid)
    : undefined;
  const fieldId =
    taskObject?.attributes.E ??
    taskObject?.attributes.PartfieldIdRef ??
    taskObject?.attributes.PartFieldIdRef;

  return (
    dataset.boundaries.find(
      (boundary) =>
        boundary.id === activeBoundaryId && boundary.taskId === grid.taskId,
    ) ??
    dataset.boundaries.find((boundary) => boundary.taskId === grid.taskId) ??
    dataset.boundaries.find((boundary) => boundary.id === fieldId) ??
    (dataset.boundaries.length === 1 ? dataset.boundaries[0] : undefined)
  );
}

function traceBoundaryPath(
  context: CanvasRenderingContext2D,
  map: LeafletMap,
  boundary: SpatialBoundary,
): void {
  context.beginPath();
  boundary.coordinates.forEach(([latitude, longitude], index) => {
    const point = map.latLngToContainerPoint([latitude, longitude]);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function fittedCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (context.measureText(value).width <= maxWidth) return value;
  let fitted = value;
  while (
    fitted.length > 1 &&
    context.measureText(`${fitted}…`).width > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}…`;
}

function drawExportLegend(
  context: CanvasRenderingContext2D,
  width: number,
  i18n: I18n,
  channel: GridChannel,
  min: number,
  max: number,
  classColors: readonly string[],
  averageDose: string | undefined,
  totalDose: string | undefined,
): void {
  const rows = [
    ...(averageDose ? [["Average dose", averageDose]] : []),
    ...(totalDose ? [["Total dose", totalDose]] : []),
  ];
  const panelWidth = Math.min(240, width - 28);
  const panelHeight = 124 + rows.length * 19;
  const x = Math.max(14, width - panelWidth - 14);
  const y = 14;
  const innerX = x + 13;
  const innerWidth = panelWidth - 26;

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = "rgba(10, 19, 16, 0.92)";
  context.fillRect(x, y, panelWidth, panelHeight);
  context.strokeStyle = "rgba(197, 214, 204, 0.28)";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, panelWidth - 1, panelHeight - 1);

  context.fillStyle = "#b5d779";
  context.fillRect(innerX, y + 13, 8, 8);
  context.fillStyle = "#8f9d96";
  context.font = '8px Consolas, "SFMono-Regular", monospace';
  context.textBaseline = "top";
  context.fillText(i18n.t("Planned · active").toUpperCase(), innerX + 14, y + 13);

  context.fillStyle = "#dce5df";
  context.font = "600 14px Inter, Arial, sans-serif";
  context.fillText(
    fittedCanvasText(
      context,
      channel.productName ?? i18n.t("Product unresolved"),
      innerWidth,
    ),
    innerX,
    y + 37,
  );
  context.fillStyle = "#9caaa3";
  context.font = "9px Inter, Arial, sans-serif";
  context.fillText(
    fittedCanvasText(
      context,
      `DDI ${channel.ddiDisplay} · ${channel.ddiName}`,
      innerWidth,
    ),
    innerX,
    y + 57,
  );

  const rampY = y + 78;
  const segmentWidth = classColors.length
    ? innerWidth / classColors.length
    : innerWidth;
  classColors.forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect(
      innerX + segmentWidth * index,
      rampY,
      segmentWidth + 0.25,
      10,
    );
  });

  context.font = '8px Consolas, "SFMono-Regular", monospace';
  context.fillStyle = "#85948c";
  context.textAlign = "left";
  context.fillText(
    min.toFixed(channel.presentation.decimals),
    innerX,
    rampY + 13,
  );
  context.textAlign = "right";
  context.fillText(
    max.toFixed(channel.presentation.decimals),
    innerX + innerWidth,
    rampY + 13,
  );
  context.fillStyle = "#c9d5ce";
  context.textAlign = "center";
  context.fillText(
    fittedCanvasText(
      context,
      channel.unit ?? i18n.t("unit unknown"),
      innerWidth / 2,
    ),
    innerX + innerWidth / 2,
    rampY + 13,
  );

  const ruleY = y + 109.5;
  context.strokeStyle = "rgba(197, 214, 204, 0.16)";
  context.beginPath();
  context.moveTo(innerX, ruleY);
  context.lineTo(innerX + innerWidth, ruleY);
  context.stroke();

  context.font = "10px Inter, Arial, sans-serif";
  rows.forEach(([label, value], index) => {
    const rowY = y + 122 + index * 19;
    context.fillStyle = "#7f8d86";
    context.textAlign = "left";
    context.fillText(label, innerX, rowY);
    const labelWidth = context.measureText(label).width;
    context.fillStyle = "#c9d4ce";
    context.font = '10px Consolas, "SFMono-Regular", monospace';
    context.textAlign = "right";
    context.fillText(
      fittedCanvasText(context, value, innerWidth - labelWidth - 10),
      innerX + innerWidth,
      rowY,
    );
    context.font = "10px Inter, Arial, sans-serif";
  });
  context.restore();
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The map image could not be encoded."));
    }, "image/png");
  });
}

interface MapWorkspaceProps {
  dataset: IsoXmlDataset;
  grid: DecodedGrid;
  channel: GridChannel;
}

export function MapWorkspace({ dataset, grid, channel }: MapWorkspaceProps) {
  const locale = useViewerStore((state) => state.locale);
  const i18n = useMemo(() => createI18n(locale), [locale]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | undefined>(undefined);
  const mapReadyRef = useRef(false);
  const gridRef = useRef(grid);
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const tileLayerRef = useRef<TileLayer | undefined>(undefined);
  const leafletRef = useRef<typeof import("leaflet") | undefined>(undefined);
  const drawRef = useRef<() => void>(() => {});
  const gridRasterCanvasRef = useRef<
    | {
        source: MapGridRaster;
        canvas: HTMLCanvasElement;
      }
    | undefined
  >(undefined);
  const hiddenCellMaskRef = useRef<Uint8Array>(new Uint8Array());
  const fieldClipRef = useRef<{
    enabled: boolean;
    boundary?: SpatialBoundary;
  }>({ enabled: false });
  const displayFilterControlRef = useRef<HTMLDivElement>(null);
  const baseLayerControlRef = useRef<HTMLDivElement>(null);
  const renderModeLabelRef = useRef<HTMLSpanElement>(null);
  const pinnedLatLngRef = useRef<
    { latitude: number; longitude: number } | undefined
  >(undefined);
  const pinPlacementActiveRef = useRef(false);
  const measureModeActiveRef = useRef(false);
  const [liveCoordinate, setLiveCoordinate] = useState(() =>
    isSpatialGridValid(grid)
      ? `${grid.origin.latitude.toFixed(6)}, ${grid.origin.longitude.toFixed(6)}`
      : i18n.t("Coordinates unavailable"),
  );
  const [pinnedCoordinate, setPinnedCoordinate] = useState<string>();
  const [pinnedScreenPosition, setPinnedScreenPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [pinPlacementActive, setPinPlacementActive] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [baseLayerMenuOpen, setBaseLayerMenuOpen] = useState(false);
  const [displayFilterMenuOpen, setDisplayFilterMenuOpen] = useState(false);
  const [mapExportError, setMapExportError] = useState<string>();
  const [measureModeActive, setMeasureModeActive] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const selectedCellIndex = useViewerStore((state) => state.selectedCellIndex);
  const hoveredCellIndex = useViewerStore((state) => state.hoveredCellIndex);
  const setSelectedCell = useViewerStore((state) => state.setSelectedCell);
  const setHoveredCell = useViewerStore((state) => state.setHoveredCell);
  const baseLayer = useViewerStore((state) => state.baseLayer);
  const setBaseLayer = useViewerStore((state) => state.setBaseLayer);
  const hideEmptyCells = useViewerStore((state) => state.hideEmptyCells);
  const setHideEmptyCells = useViewerStore((state) => state.setHideEmptyCells);
  const hideOutliers = useViewerStore((state) => state.hideOutliers);
  const setHideOutliers = useViewerStore((state) => state.setHideOutliers);
  const clipToField = useViewerStore((state) => state.clipToField);
  const setClipToField = useViewerStore((state) => state.setClipToField);
  const activeBoundaryId = useViewerStore((state) => state.activeBoundaryId);
  const mapFitNonce = useViewerStore((state) => state.mapFitNonce);
  const initialBaseLayerRef = useRef(baseLayer);
  const spatiallyValid = isSpatialGridValid(grid);
  const fieldBoundary = useMemo(
    () => fieldBoundaryForGrid(dataset, grid, activeBoundaryId),
    [activeBoundaryId, dataset, grid],
  );
  const fieldClipActive = clipToField && Boolean(fieldBoundary);
  const activeDisplayFilterCount =
    Number(hideEmptyCells) + Number(hideOutliers) + Number(fieldClipActive);

  const setPinPlacementMode = useCallback((active: boolean) => {
    pinPlacementActiveRef.current = active;
    setPinPlacementActive(active);
  }, []);

  const setMeasureMode = useCallback((active: boolean) => {
    measureModeActiveRef.current = active;
    setMeasureModeActive(active);
  }, []);

  const clearPinnedCoordinate = useCallback(() => {
    pinnedLatLngRef.current = undefined;
    setPinnedCoordinate(undefined);
    setPinnedScreenPosition(undefined);
  }, []);

  const clearMeasurement = useCallback(() => {
    setMeasurementPoints([]);
    setMeasureMode(false);
  }, []);

  const totalMeasuredDistance = useMemo(
    () => polylineDistanceMeters(measurementPoints),
    [measurementPoints],
  );

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    if (!baseLayerMenuOpen && !displayFilterMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedInsideOpenMenu = displayFilterMenuOpen
        ? displayFilterControlRef.current?.contains(target)
        : baseLayerControlRef.current?.contains(target);
      if (!clickedInsideOpenMenu) {
        setBaseLayerMenuOpen(false);
        setDisplayFilterMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBaseLayerMenuOpen(false);
      setDisplayFilterMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [baseLayerMenuOpen, displayFilterMenuOpen]);

  const channelIndex = grid.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const {
    numericValueByCell,
    emptyCells,
    noDataCells,
    zeroCells,
    outlierCells,
  } = useMemo(
    () =>
      buildMapChannelValues(
        grid.rawValues[channelIndex],
        grid.decodedCellCount,
        channel.presentation,
      ),
    [channel.presentation, channelIndex, grid.decodedCellCount, grid.rawValues],
  );
  const hiddenCellMask = useMemo(() => {
    const result = new Uint8Array(numericValueByCell.length);
    result.forEach((_, index) => {
      if (
        (hideEmptyCells && emptyCells[index]) ||
        (hideOutliers && outlierCells[index])
      ) {
        result[index] = 1;
      }
    });
    return result;
  }, [
    emptyCells,
    hideEmptyCells,
    hideOutliers,
    numericValueByCell.length,
    outlierCells,
  ]);

  useEffect(() => {
    hiddenCellMaskRef.current = hiddenCellMask;
  }, [hiddenCellMask]);

  useEffect(() => {
    fieldClipRef.current = {
      enabled: fieldClipActive,
      boundary: fieldBoundary,
    };
  }, [fieldBoundary, fieldClipActive]);

  const outsideFieldCellMask = useMemo(() => {
    if (!fieldClipActive || !fieldBoundary || !spatiallyValid) {
      return new Uint8Array(numericValueByCell.length);
    }
    const result = new Uint8Array(numericValueByCell.length);
    result.forEach((_, index) => {
      const center = geographicCellCenter(
        grid,
        Math.floor(index / grid.columns),
        index % grid.columns,
      );
      if (
        !center ||
        !pointIsInsideBoundary(center.latitude, center.longitude, fieldBoundary)
      ) {
        result[index] = 1;
      }
    });
    return result;
  }, [
    fieldBoundary,
    fieldClipActive,
    grid,
    numericValueByCell.length,
    spatiallyValid,
  ]);
  const legendFilteredCellMask = useMemo(() => {
    const result = new Uint8Array(hiddenCellMask.length);
    result.forEach((_, index) => {
      if (hiddenCellMask[index] || outsideFieldCellMask[index]) {
        result[index] = 1;
      }
    });
    return result;
  }, [hiddenCellMask, outsideFieldCellMask]);

  const valueClassification = useMemo(
    () => classifyValues(numericValueByCell, 10, legendFilteredCellMask),
    [legendFilteredCellMask, numericValueByCell],
  );
  const classColors = useMemo(
    () => colorsForClasses(valueClassification.classCount),
    [valueClassification.classCount],
  );
  const gridRaster = useMemo(
    () =>
      buildMapGridRaster(
        grid,
        hiddenCellMask,
        noDataCells,
        numericValueByCell,
        valueClassification,
        classColors,
      ),
    [
      classColors,
      grid,
      hiddenCellMask,
      noDataCells,
      numericValueByCell,
      valueClassification,
    ],
  );
  const scaleLabel = scaleDescription(valueClassification, i18n);
  const min = valueClassification.min;
  const max = valueClassification.max;
  const zeroCount = zeroCells.filter(
    (isZero, index) => isZero && !outsideFieldCellMask[index],
  ).length;
  const outlierCount = outlierCells.filter(Boolean).length;
  const noDataCount =
    noDataCells.filter(Boolean).length +
    Math.max(0, grid.expectedCellCount - grid.decodedCellCount);
  const filteredCellCount = legendFilteredCellMask.filter(Boolean).length;
  const visibleCellCount = grid.decodedCellCount - filteredCellCount;
  const cellAreaSquareMeters = gridCellAreaSquareMeters(grid);
  const cellDimensionsMeters = gridCellDimensionsMeters(grid);
  const doseStatistics = useMemo(
    () =>
      calculateDoseStatistics(
        numericValueByCell,
        cellAreaSquareMeters,
        channel.unit,
        legendFilteredCellMask,
      ),
    [
      cellAreaSquareMeters,
      channel.unit,
      legendFilteredCellMask,
      numericValueByCell,
    ],
  );
  const averageDose =
    doseStatistics.average === undefined
      ? undefined
      : `${formatMapStatistic(
          doseStatistics.average,
          channel.presentation.decimals,
          locale,
        )}${doseStatistics.averageUnit ? ` ${doseStatistics.averageUnit}` : ""}`;
  const totalDose =
    doseStatistics.total === undefined
      ? undefined
      : `${formatMapStatistic(
          doseStatistics.total,
          channel.presentation.decimals,
          locale,
        )}${doseStatistics.totalUnit ? ` ${doseStatistics.totalUnit}` : ""}`;
  const hoveredRawValue =
    hoveredCellIndex !== undefined
      ? grid.rawValues[channelIndex]?.[hoveredCellIndex]
      : undefined;
  const hoveredValue =
    hoveredRawValue === undefined
      ? undefined
      : decodeValue(hoveredRawValue, channel.presentation);

  const paintDataLayer = useCallback(
    (
      context: CanvasRenderingContext2D,
      map: LeafletMap,
      includeSelection: boolean,
    ) => {
      context.save();
      if (fieldClipActive && fieldBoundary) {
        traceBoundaryPath(context, map, fieldBoundary);
        context.clip();
      }
      const gridBounds = geographicGridBounds(grid);
      if (gridRaster && gridBounds) {
        let cachedRaster = gridRasterCanvasRef.current;
        if (!cachedRaster || cachedRaster.source !== gridRaster) {
          const rasterCanvas = document.createElement("canvas");
          rasterCanvas.width = gridRaster.width;
          rasterCanvas.height = gridRaster.height;
          const rasterContext = rasterCanvas.getContext("2d");
          if (rasterContext) {
            const imageData = rasterContext.createImageData(
              gridRaster.width,
              gridRaster.height,
            );
            imageData.data.set(gridRaster.pixels);
            rasterContext.putImageData(imageData, 0, 0);
          }
          cachedRaster = { source: gridRaster, canvas: rasterCanvas };
          gridRasterCanvasRef.current = cachedRaster;
        }
        const [[south, west], [north, east]] = gridBounds;
        const topLeft = map.latLngToContainerPoint([north, west]);
        const bottomRight = map.latLngToContainerPoint([south, east]);
        context.imageSmoothingEnabled = false;
        context.globalAlpha = 1;
        context.drawImage(
          cachedRaster.canvas,
          topLeft.x,
          topLeft.y,
          bottomRight.x - topLeft.x,
          bottomRight.y - topLeft.y,
        );
        if (renderModeLabelRef.current) {
          renderModeLabelRef.current.textContent = i18n.t("Raster");
        }
      } else {
        const mapBounds = map.getBounds();
        const visibleRange = gridCellRangeForBounds(grid, {
          north: mapBounds.getNorth(),
          south: mapBounds.getSouth(),
          east: mapBounds.getEast(),
          west: mapBounds.getWest(),
        });
        const visibleRows = visibleRange
          ? visibleRange.lastRow - visibleRange.firstRow + 1
          : 0;
        const visibleColumns = visibleRange
          ? visibleRange.lastColumn - visibleRange.firstColumn + 1
          : 0;
        const renderStride = Math.max(
          1,
          Math.ceil(
            Math.sqrt((visibleRows * visibleColumns) / MAX_PAINTED_CELL_BLOCKS),
          ),
        );
        if (renderModeLabelRef.current) {
          renderModeLabelRef.current.textContent =
            renderStride > 1
              ? i18n.t("Sampled {stride}×{stride}", {
                  stride: renderStride,
                })
              : i18n.t("Canvas");
        }
        for (
          let row = visibleRange?.firstRow ?? 0;
          row <= (visibleRange?.lastRow ?? -1);
          row += renderStride
        ) {
          for (
            let column = visibleRange?.firstColumn ?? 0;
            column <= (visibleRange?.lastColumn ?? -1);
            column += renderStride
          ) {
            const sampleRow = Math.min(
              row + Math.floor(renderStride / 2),
              visibleRange?.lastRow ?? row,
            );
            const sampleColumn = Math.min(
              column + Math.floor(renderStride / 2),
              visibleRange?.lastColumn ?? column,
            );
            const index = sampleRow * grid.columns + sampleColumn;
            if (index >= grid.decodedCellCount || hiddenCellMask[index]) {
              continue;
            }
            const firstBounds = geographicCellBounds(grid, row, column);
            const lastBounds = geographicCellBounds(
              grid,
              Math.min(row + renderStride - 1, grid.rows - 1),
              Math.min(column + renderStride - 1, grid.columns - 1),
            );
            if (!firstBounds || !lastBounds) continue;
            const north = Math.max(firstBounds.north, lastBounds.north);
            const south = Math.min(firstBounds.south, lastBounds.south);
            const west = Math.min(firstBounds.west, lastBounds.west);
            const east = Math.max(firstBounds.east, lastBounds.east);
            const topLeft = map.latLngToContainerPoint([north, west]);
            const bottomRight = map.latLngToContainerPoint([south, east]);
            const width = bottomRight.x - topLeft.x;
            const height = bottomRight.y - topLeft.y;
            context.fillStyle = noDataCells[index]
              ? "#3c4541"
              : colorFor(
                  numericValueByCell[index],
                  valueClassification,
                  classColors,
                );
            context.globalAlpha = 0.88;
            context.fillRect(topLeft.x, topLeft.y, width + 0.35, height + 0.35);
            context.strokeStyle = "rgba(8, 18, 16, 0.34)";
            context.lineWidth = 0.7;
            context.strokeRect(topLeft.x, topLeft.y, width, height);
          }
        }
      }
      if (
        includeSelection &&
        selectedCellIndex !== undefined &&
        !hiddenCellMask[selectedCellIndex]
      ) {
        const selectedBounds = geographicCellBounds(
          grid,
          Math.floor(selectedCellIndex / grid.columns),
          selectedCellIndex % grid.columns,
        );
        if (selectedBounds) {
          const topLeft = map.latLngToContainerPoint([
            selectedBounds.north,
            selectedBounds.west,
          ]);
          const bottomRight = map.latLngToContainerPoint([
            selectedBounds.south,
            selectedBounds.east,
          ]);
          const width = bottomRight.x - topLeft.x;
          const height = bottomRight.y - topLeft.y;
          context.globalAlpha = 1;
          context.strokeStyle = "#f3f7ed";
          context.lineWidth = 2;
          context.strokeRect(
            topLeft.x + 1,
            topLeft.y + 1,
            width - 2,
            height - 2,
          );
          context.strokeStyle = "#0b1411";
          context.lineWidth = 1;
          context.strokeRect(
            topLeft.x + 3,
            topLeft.y + 3,
            width - 6,
            height - 6,
          );
        }
      }
      context.restore();

      drawMeasurementOverlay(context, map, measurementPoints, i18n);

      context.save();
      for (const boundary of dataset.boundaries) {
        if (boundary.coordinates.length < 2) continue;
        traceBoundaryPath(context, map, boundary);
        context.globalAlpha = 1;
        context.strokeStyle = "#d5e59d";
        context.setLineDash([7, 5]);
        context.lineWidth = 1.6;
        context.stroke();
        context.setLineDash([]);
      }
      context.restore();
    },
    [
      dataset.boundaries,
      fieldBoundary,
      fieldClipActive,
      grid,
      gridRaster,
      hiddenCellMask,
      classColors,
      i18n,
      measurementPoints,
      noDataCells,
      numericValueByCell,
      selectedCellIndex,
      valueClassification,
    ],
  );

  const draw = useCallback(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(size.x * ratio));
    const backingHeight = Math.max(1, Math.round(size.y * ratio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    if (canvas.style.width !== `${size.x}px`) {
      canvas.style.width = `${size.x}px`;
    }
    if (canvas.style.height !== `${size.y}px`) {
      canvas.style.height = `${size.y}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    paintDataLayer(context, map, true);
  }, [paintDataLayer]);

  const fitGrid = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const bounds = geographicGridBounds(grid);
    if (!bounds) return;
    map.stop();
    map.fitBounds(bounds, {
      padding: [54, 54],
      animate: false,
    });
  }, [grid]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let redrawFrame: number | undefined;
    let resizeFrame: number | undefined;
    let hoverFrame: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    void import("leaflet").then((leaflet) => {
      if (disposed || !containerRef.current) return;
      leafletRef.current = leaflet;
      const activeGrid = gridRef.current;
      setLiveCoordinate(
        isSpatialGridValid(activeGrid)
          ? `${activeGrid.origin.latitude.toFixed(6)}, ${activeGrid.origin.longitude.toFixed(6)}`
          : i18n.t("Coordinates unavailable"),
      );
      const map = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        zoomSnap: ZOOM_STEP,
        zoomDelta: ZOOM_STEP,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      });
      mapRef.current = map;
      const bounds = geographicGridBounds(activeGrid);
      if (bounds) {
        map.fitBounds(bounds, { padding: [54, 54], animate: false });
      } else map.setView([20, 0], 2);
      mapReadyRef.current = true;
      const syncMapZoom = () => {
        if (containerRef.current) {
          containerRef.current.dataset.mapZoom = map.getZoom().toFixed(2);
        }
      };
      map.on("zoomend", syncMapZoom);
      syncMapZoom();
      leaflet.control
        .scale({ imperial: false, position: "bottomleft" })
        .addTo(map);
      if (initialBaseLayerRef.current === "streets") {
        tileLayerRef.current = leaflet
          .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            crossOrigin: true,
            ...BASEMAP_ZOOM_OPTIONS,
          })
          .addTo(map);
        tileLayerRef.current.bringToBack();
      } else if (initialBaseLayerRef.current === "satellite") {
        tileLayerRef.current = leaflet
          .tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
              attribution:
                "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
              crossOrigin: true,
              ...BASEMAP_ZOOM_OPTIONS,
            },
          )
          .addTo(map);
        tileLayerRef.current.bringToBack();
      }

      const canvas = document.createElement("canvas");
      canvas.className = "map-data-canvas";
      canvas.setAttribute("aria-hidden", "true");
      containerRef.current.appendChild(canvas);
      canvasRef.current = canvas;

      const redraw = () => {
        if (redrawFrame !== undefined) return;
        redrawFrame = requestAnimationFrame(() => {
          redrawFrame = undefined;
          drawRef.current();
          const pinnedLatLng = pinnedLatLngRef.current;
          if (!pinnedLatLng) return;
          const point = map.latLngToContainerPoint([
            pinnedLatLng.latitude,
            pinnedLatLng.longitude,
          ]);
          setPinnedScreenPosition((current) =>
            current && current.x === point.x && current.y === point.y
              ? current
              : { x: point.x, y: point.y },
          );
        });
      };
      resizeObserver = new ResizeObserver(() => {
        if (resizeFrame !== undefined) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined;
          if (disposed) return;
          map.invalidateSize({ animate: false, pan: false });
          redraw();
        });
      });
      resizeObserver.observe(containerRef.current);
      let pendingHover:
        | { latitude: number; longitude: number; x: number; y: number }
        | undefined;
      const updateHover = () => {
        hoverFrame = undefined;
        const hover = pendingHover;
        if (!hover) return;
        pendingHover = undefined;
        const activeEventGrid = gridRef.current;
        const candidateIndex = gridCellIndexAt(
          activeEventGrid,
          hover.latitude,
          hover.longitude,
        );
        const hiddenCells = hiddenCellMaskRef.current;
        const { enabled, boundary } = fieldClipRef.current;
        const insideField =
          !enabled ||
          !boundary ||
          pointIsInsideBoundary(hover.latitude, hover.longitude, boundary);
        const index =
          candidateIndex !== undefined &&
          !hiddenCells[candidateIndex] &&
          insideField
            ? candidateIndex
            : undefined;
        setHoveredCell(index);
        setLiveCoordinate(
          `${hover.latitude.toFixed(6)}, ${hover.longitude.toFixed(6)}`,
        );
        setHoverPosition(
          index === undefined
            ? undefined
            : { x: hover.x + 14, y: hover.y + 14 },
        );
      };
      const clearHover = () => {
        pendingHover = undefined;
        if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
        hoverFrame = undefined;
        setHoveredCell(undefined);
        setHoverPosition(undefined);
      };
      map.on("move zoom resize", redraw);
      map.on("mousemove", (event) => {
        pendingHover = {
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
          x: event.containerPoint.x,
          y: event.containerPoint.y,
        };
        if (hoverFrame === undefined) {
          hoverFrame = requestAnimationFrame(updateHover);
        }
      });
      map.on("mouseout movestart zoomstart", clearHover);
      map.on("click", (event) => {
        const candidateIndex = gridCellIndexAt(
          gridRef.current,
          event.latlng.lat,
          event.latlng.lng,
        );
        const hiddenCells = hiddenCellMaskRef.current;
        const { enabled, boundary } = fieldClipRef.current;
        const insideField =
          !enabled ||
          !boundary ||
          pointIsInsideBoundary(event.latlng.lat, event.latlng.lng, boundary);
        const index =
          candidateIndex !== undefined &&
          !hiddenCells[candidateIndex] &&
          insideField
            ? candidateIndex
            : undefined;
        if (measureModeActiveRef.current) {
          setMeasurementPoints((current) => [
            ...current,
            { latitude: event.latlng.lat, longitude: event.latlng.lng },
          ]);
          return;
        }
        if (index !== undefined) {
          clearPinnedCoordinate();
          setPinPlacementMode(false);
          setSelectedCell(index);
          return;
        }
        if (pinPlacementActiveRef.current) {
          setSelectedCell(undefined);
          pinnedLatLngRef.current = {
            latitude: event.latlng.lat,
            longitude: event.latlng.lng,
          };
          setPinnedCoordinate(
            `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`,
          );
          setPinnedScreenPosition({
            x: event.containerPoint.x,
            y: event.containerPoint.y,
          });
          setPinPlacementMode(false);
          return;
        }
        setSelectedCell(undefined);
      });
      redraw();
    });

    return () => {
      disposed = true;
      if (redrawFrame !== undefined) cancelAnimationFrame(redrawFrame);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
      resizeObserver?.disconnect();
      mapReadyRef.current = false;
      mapRef.current?.stop();
      tileLayerRef.current?.remove();
      tileLayerRef.current = undefined;
      canvasRef.current?.remove();
      mapRef.current?.off();
      mapRef.current?.remove();
      mapRef.current = undefined;
      canvasRef.current = undefined;
    };
  }, [
    clearPinnedCoordinate,
    setHoveredCell,
    setPinPlacementMode,
    setSelectedCell,
  ]);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      setLiveCoordinate(
        spatiallyValid
          ? `${grid.origin.latitude.toFixed(6)}, ${grid.origin.longitude.toFixed(6)}`
          : i18n.t("Coordinates unavailable"),
      );
      clearPinnedCoordinate();
      setPinPlacementMode(false);
      setMeasureMode(false);
      fitGrid();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [
    clearPinnedCoordinate,
    fitGrid,
    grid.origin.latitude,
    grid.origin.longitude,
    i18n,
    setMeasureMode,
    setPinPlacementMode,
    spatiallyValid,
  ]);

  useEffect(() => {
    if (selectedCellIndex === undefined) return;
    const animationFrame = requestAnimationFrame(() => {
      clearPinnedCoordinate();
      setPinPlacementMode(false);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [clearPinnedCoordinate, selectedCellIndex, setPinPlacementMode]);

  useEffect(() => {
    initialBaseLayerRef.current = baseLayer;
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;
    tileLayerRef.current?.remove();
    tileLayerRef.current = undefined;
    if (baseLayer === "streets") {
      tileLayerRef.current = leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          crossOrigin: true,
          ...BASEMAP_ZOOM_OPTIONS,
        })
        .addTo(map);
      tileLayerRef.current.bringToBack();
    } else if (baseLayer === "satellite") {
      tileLayerRef.current = leaflet
        .tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution:
              "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            crossOrigin: true,
            ...BASEMAP_ZOOM_OPTIONS,
          },
        )
        .addTo(map);
      tileLayerRef.current.bringToBack();
    }
  }, [baseLayer]);

  useEffect(() => {
    if (mapFitNonce > 0) fitGrid();
  }, [fitGrid, mapFitNonce]);

  const exportMap = async () => {
    try {
      setMapExportError(undefined);
      const container = containerRef.current;
      const map = mapRef.current;
      if (!container || !map) return;
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = size.x * ratio;
      exportCanvas.height = size.y * ratio;
      const context = exportCanvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const workspace = container.parentElement;
      const workspaceStyle = workspace
        ? window.getComputedStyle(workspace)
        : undefined;
      const background =
        workspaceStyle?.getPropertyValue("--map").trim() || "#0b1918";
      context.fillStyle = background;
      context.fillRect(0, 0, size.x, size.y);
      context.strokeStyle = workspace?.closest(".viewer-shell.light")
        ? "rgba(36, 127, 114, 0.08)"
        : "rgba(84, 176, 162, 0.06)";
      context.lineWidth = 1;
      for (let x = 24; x < size.x; x += 24) {
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, size.y);
        context.stroke();
      }
      for (let y = 24; y < size.y; y += 24) {
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(size.x, y + 0.5);
        context.stroke();
      }

      const containerBounds = container.getBoundingClientRect();
      const tiles = Array.from(
        container.querySelectorAll<HTMLImageElement>(".leaflet-tile-loaded"),
      );
      tiles.forEach((tile) => {
        const tileBounds = tile.getBoundingClientRect();
        if (!tile.complete || !tile.naturalWidth || !tileBounds.width) return;
        context.drawImage(
          tile,
          tileBounds.left - containerBounds.left,
          tileBounds.top - containerBounds.top,
          tileBounds.width,
          tileBounds.height,
        );
      });

      paintDataLayer(context, map, true);
      drawExportLegend(
        context,
        size.x,
        i18n,
        channel,
        min,
        max,
        classColors,
        averageDose,
        totalDose,
      );

      if (
        selectedCellIndex !== undefined &&
        !legendFilteredCellMask[selectedCellIndex]
      ) {
        const row = Math.floor(selectedCellIndex / grid.columns);
        const column = selectedCellIndex % grid.columns;
        const center = geographicCellCenter(grid, row, column);
        const rawValue = grid.rawValues[channelIndex]?.[selectedCellIndex];
        if (center && rawValue !== undefined) {
          const anchor = map.latLngToContainerPoint([
            center.latitude,
            center.longitude,
          ]);
          if (
            anchor.x >= 0 &&
            anchor.y >= 0 &&
            anchor.x <= size.x &&
            anchor.y <= size.y
          ) {
            const selectedValue = decodeValue(rawValue, channel.presentation);
            drawMapScreenshotTooltip(context, size.x, size.y, {
              anchor,
              headerLabel: `R${row + 1} · C${column + 1}`,
              headerValue: `#${selectedCellIndex}`,
              formattedValue: selectedValue.formattedValue,
              unit: channel.unit,
              rows: [
                { label: i18n.t("Raw"), value: String(selectedValue.rawValue) },
                {
                  label: i18n.t("Layout"),
                  value:
                    grid.gridType === 2
                      ? i18n.t("Direct")
                      : i18n.t("Zone {zone}", {
                          zone: grid.treatmentZoneCodes[selectedCellIndex],
                        }),
                },
                {
                  label: "PDV",
                  value: `${channel.pdvIndex + 1} / ${grid.channels.length}`,
                },
              ],
            });
          }
        }
      }

      if (baseLayer !== "none") {
        const attributionLines =
          baseLayer === "streets"
            ? ["© OpenStreetMap contributors"]
            : [
                "Tiles © Esri — Source: Esri, Maxar,",
                "Earthstar Geographics, and the GIS User Community",
              ];
        context.save();
        context.font = "8px Arial, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "bottom";
        const attributionWidth = Math.min(
          Math.max(
            ...attributionLines.map((line) => context.measureText(line).width),
          ) + 10,
          size.x,
        );
        const attributionHeight = attributionLines.length * 10 + 7;
        context.fillStyle = "rgba(9, 17, 15, 0.76)";
        context.fillRect(
          size.x - attributionWidth,
          size.y - attributionHeight,
          attributionWidth,
          attributionHeight,
        );
        context.fillStyle = "#c8d2cc";
        attributionLines.forEach((line, index) => {
          context.fillText(
            fittedCanvasText(context, line, size.x - 10),
            size.x - 5,
            size.y - 4 - (attributionLines.length - index - 1) * 10,
          );
        });
        context.restore();
      }

      const blob = await canvasBlob(exportCanvas);
      downloadBlob(blob, `${grid.id}-${channel.ddiDisplay}-map.png`);
    } catch (error) {
      console.error("Map export failed.", error);
      setMapExportError(
        baseLayer === "none"
          ? i18n.t("The map image could not be exported.")
          : i18n.t(
              "The browser blocked pixels from the background map. Choose No background and try again.",
            ),
      );
    }
  };

  const hoveredRow =
    hoveredCellIndex !== undefined
      ? Math.floor(hoveredCellIndex / grid.columns)
      : 0;
  const hoveredColumn =
    hoveredCellIndex !== undefined ? hoveredCellIndex % grid.columns : 0;
  const selectedCellCoordinate =
    selectedCellIndex === undefined
      ? undefined
      : geographicCellCenter(
          grid,
          Math.floor(selectedCellIndex / grid.columns),
          selectedCellIndex % grid.columns,
        );
  const selectedCoordinate = selectedCellCoordinate
    ? `${selectedCellCoordinate.latitude.toFixed(6)}, ${selectedCellCoordinate.longitude.toFixed(6)}`
    : undefined;
  const displayedCoordinate =
    selectedCoordinate ?? pinnedCoordinate ?? liveCoordinate;
  const coordinateKind = selectedCoordinate
    ? "selected"
    : pinnedCoordinate
      ? "pinned"
      : "live";

  return (
    <main
      className={`map-workspace${pinPlacementActive ? " pin-placement-active" : ""}${measureModeActive ? " measure-mode-active" : ""}`}
      aria-label={i18n.t("Interactive ISOXML map")}
    >
      <div
        className="map-container"
        ref={containerRef}
        data-testid="isoxml-map"
      />
      <div className="map-control-stack top-left">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn(ZOOM_STEP, { animate: false })}
          aria-label={i18n.t("Zoom in")}
          title={i18n.t("Zoom in")}
          data-tooltip={i18n.t("Zoom in")}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut(ZOOM_STEP, { animate: false })}
          aria-label={i18n.t("Zoom out")}
          title={i18n.t("Zoom out")}
          data-tooltip={i18n.t("Zoom out")}
        >
          <Minus size={16} />
        </button>
        <span />
        <button
          type="button"
          onClick={fitGrid}
          aria-label={i18n.t("Fit active grid to the map")}
          title={i18n.t("Fit active grid to the map")}
          data-tooltip={i18n.t("Fit active grid to the map")}
        >
          <Crosshair size={16} />
        </button>
        <button
          type="button"
          className={pinPlacementActive ? "active" : ""}
          onClick={() => {
            setMeasureMode(false);
            setPinPlacementMode(!pinPlacementActive);
          }}
          aria-label={
            pinPlacementActive
              ? i18n.t("Cancel coordinate pin placement")
              : i18n.t("Place a coordinate pin")
          }
          aria-pressed={pinPlacementActive}
          title={
            pinPlacementActive
              ? i18n.t("Cancel coordinate pin placement")
              : i18n.t("Place a coordinate pin on empty map space")
          }
          data-tooltip={
            pinPlacementActive
              ? i18n.t("Cancel coordinate pin placement")
              : i18n.t("Place a coordinate pin")
          }
        >
          <MapPin size={16} />
        </button>
        <div className="measure-control">
          <button
            type="button"
            className={measureModeActive ? "active" : ""}
            onClick={() => {
              setPinPlacementMode(false);
              setMeasureMode(!measureModeActive);
            }}
            aria-label={
              measureModeActive
                ? i18n.t("Stop measuring")
                : i18n.t("Measure distance")
            }
            aria-pressed={measureModeActive}
            title={
              measureModeActive
                ? i18n.t("Stop measuring")
                : i18n.t("Click map to add measurement points")
            }
            data-tooltip={
              measureModeActive
                ? i18n.t("Stop measuring")
                : i18n.t("Measure distance")
            }
          >
            <Ruler size={16} />
          </button>
          {measurementPoints.length > 0 && (
            <button
              type="button"
              className="measure-clear-button"
              onClick={(event) => {
                event.stopPropagation();
                clearMeasurement();
              }}
              aria-label={i18n.t("Clear measurement")}
              title={i18n.t("Clear measurement")}
            >
              <X size={10} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="map-filter-control" ref={displayFilterControlRef}>
          <button
            type="button"
            className={activeDisplayFilterCount ? "active" : ""}
            aria-label={`${i18n.t("Configure map display filters")}${activeDisplayFilterCount ? `: ${activeDisplayFilterCount} ${i18n.t("active")}` : ""}`}
            aria-expanded={displayFilterMenuOpen}
            title={`${i18n.t("Map display filters")}${activeDisplayFilterCount ? ` (${activeDisplayFilterCount} ${i18n.t("active")})` : ""}`}
            data-tooltip={`${i18n.t("Map display filters")}${activeDisplayFilterCount ? ` (${activeDisplayFilterCount} ${i18n.t("active")})` : ""}`}
            onClick={() => {
              setDisplayFilterMenuOpen((open) => !open);
              setBaseLayerMenuOpen(false);
            }}
          >
            <SlidersHorizontal size={16} />
          </button>
          {displayFilterMenuOpen && (
            <div
              className="map-filter-menu"
              role="menu"
              aria-label={i18n.t("Map display filters")}
            >
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={hideEmptyCells}
                className={hideEmptyCells ? "active" : ""}
                onClick={() => setHideEmptyCells(!hideEmptyCells)}
              >
                <EyeOff size={14} aria-hidden="true" />
                <span>
                  <strong>{i18n.t("Hide empty cells")}</strong>
                  <small>{i18n.t("Zero and no-data values")}</small>
                </span>
                {hideEmptyCells && <Check size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={fieldClipActive}
                className={fieldClipActive ? "active" : ""}
                disabled={!fieldBoundary}
                onClick={() => setClipToField(!clipToField)}
              >
                <Crop size={14} aria-hidden="true" />
                <span>
                  <strong>{i18n.t("Cut to field")}</strong>
                  <small>
                    {fieldBoundary?.name ?? i18n.t("No field boundary available")}
                  </small>
                </span>
                {fieldClipActive && <Check size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={hideOutliers}
                className={hideOutliers ? "active" : ""}
                onClick={() => setHideOutliers(!hideOutliers)}
              >
                <Filter size={14} aria-hidden="true" />
                <span>
                  <strong>{i18n.t("Hide outliers")}</strong>
                  <small title={i18n.t("Extreme values beyond 3× IQR, with a minimum 50% typical-value guard")}>
                    {outlierCount
                      ? `${i18n.formatInteger(outlierCount)} ${i18n.t("extreme")} · ${i18n.t("conservative 3× IQR")}`
                      : i18n.t("None detected · conservative 3× IQR")}
                  </small>
                </span>
                {hideOutliers && <Check size={14} aria-hidden="true" />}
              </button>
            </div>
          )}
        </div>
        <div className="basemap-control" ref={baseLayerControlRef}>
          <button
            type="button"
            onClick={() => {
              setBaseLayerMenuOpen((open) => !open);
              setDisplayFilterMenuOpen(false);
            }}
            aria-label={i18n.t("Choose background map")}
            aria-expanded={baseLayerMenuOpen}
            className={baseLayer !== "none" ? "active" : ""}
            title={i18n.t("Choose background map (tiles may load over the network)")}
            data-tooltip={i18n.t("Choose background map")}
          >
            <Layers size={16} />
          </button>
          {baseLayerMenuOpen && (
            <div
              className="basemap-menu"
              role="menu"
              aria-label={i18n.t("Background map")}
            >
              {(
                [
                  ["none", i18n.t("No background")],
                  ["streets", i18n.t("Streets")],
                  ["satellite", i18n.t("Satellite")],
                ] as const
              ).map(([id, label]) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={baseLayer === id}
                  className={baseLayer === id ? "active" : ""}
                  key={id}
                  onClick={() => {
                    setBaseLayer(id);
                    setBaseLayerMenuOpen(false);
                  }}
                >
                  <span>{label}</span>
                  {baseLayer === id && <b>{i18n.t("On").toUpperCase()}</b>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void exportMap()}
          aria-label={i18n.t("Export map screenshot")}
          title={i18n.t("Export map screenshot")}
          data-tooltip={i18n.t("Export map screenshot")}
        >
          <Scan size={16} />
        </button>
      </div>

      <div className="map-badge top-center">
        <span className="pulse-dot" />
        {i18n.t("Type").toUpperCase()} {grid.gridType} · {i18n.formatInteger(grid.decodedCellCount)} {i18n.t("Cells").toUpperCase()} ·{" "}
        <span ref={renderModeLabelRef}>{i18n.t("Canvas")}</span>
      </div>

      {!spatiallyValid && (
        <div className="map-spatial-error" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>{i18n.t("Grid coordinates are invalid")}</strong>
            <span>{i18n.t("The values remain available in the table and inspector.")}</span>
          </div>
        </div>
      )}

      {mapExportError && (
        <div className="map-export-error" role="alert">
          <AlertTriangle size={15} />
          <span>{mapExportError}</span>
          <button type="button" onClick={() => setMapExportError(undefined)}>
            {i18n.t("Dismiss")}
          </button>
        </div>
      )}

      <section className="map-legend" aria-label={i18n.t("Active layer legend")}>
        <div className="legend-kicker">
          <span className="layer-swatch" />
          {i18n.t("Planned · active").toUpperCase()}
        </div>
        <h2>{channel.productName ?? i18n.t("Product unresolved")}</h2>
        <p>
          DDI {channel.ddiDisplay} · {channel.ddiName}
        </p>
        <div className="legend-ramp" aria-hidden="true">
          {classColors.map((color, index) => (
            <span key={`${color}-${index}`} style={{ background: color }} />
          ))}
        </div>
        <div className="legend-range">
          <span>{min.toFixed(channel.presentation.decimals)}</span>
          <strong>{channel.unit ?? i18n.t("unit unknown")}</strong>
          <span>{max.toFixed(channel.presentation.decimals)}</span>
        </div>
        <dl>
          <div>
            <dt>{i18n.t("Scale")}</dt>
            <dd>{scaleLabel}</dd>
          </div>
          {averageDose && (
            <div>
              <dt>{i18n.t("Average dose")}</dt>
              <dd>{averageDose}</dd>
            </div>
          )}
          {totalDose && (
            <div>
              <dt>{i18n.t("Total dose")}</dt>
              <dd>{totalDose}</dd>
            </div>
          )}
          <div>
            <dt>{i18n.t("Visible / filtered")}</dt>
            <dd>
              {i18n.formatInteger(visibleCellCount)} / {i18n.formatInteger(filteredCellCount)}
            </dd>
          </div>
          <div>
            <dt>{i18n.t("Zero / no-data")}</dt>
            <dd>
              {i18n.formatInteger(zeroCount)} / {i18n.formatInteger(noDataCount)}
            </dd>
          </div>
          <div>
            <dt>{i18n.t("Source")}</dt>
            <dd>{grid.filename}</dd>
          </div>
        </dl>
      </section>

      {hoveredValue && hoverPosition && (
        <div
          className="map-tooltip"
          style={{ left: hoverPosition.x, top: hoverPosition.y }}
          role="tooltip"
        >
          <div className="tooltip-header">
            <span>
              R{hoveredRow + 1} · C{hoveredColumn + 1}
            </span>
            <strong>#{hoveredCellIndex}</strong>
          </div>
          <div className="tooltip-value">
            {hoveredValue.formattedValue}
            <small>{channel.unit}</small>
          </div>
          <dl>
            <div>
              <dt>{i18n.t("Raw")}</dt>
              <dd>{hoveredValue.rawValue}</dd>
            </div>
            <div>
              <dt>{i18n.t("Layout")}</dt>
              <dd>
                {grid.gridType === 2
                  ? i18n.t("Direct")
                  : i18n.t("Zone {zone}", {
                      zone: grid.treatmentZoneCodes[hoveredCellIndex ?? 0],
                    })}
              </dd>
            </div>
            <div>
              <dt>PDV</dt>
              <dd>
                {channel.pdvIndex + 1} / {grid.channels.length}
              </dd>
            </div>
          </dl>
          <span className="tooltip-hint">
            {i18n.t("Click to select this cell and show its coordinate")}
          </span>
        </div>
      )}

      {!selectedCoordinate && pinnedCoordinate && pinnedScreenPosition && (
        <button
          type="button"
          className="map-coordinate-pin"
          style={{
            left: pinnedScreenPosition.x,
            top: pinnedScreenPosition.y,
          }}
          aria-label={`${i18n.t("Remove pinned coordinate")} ${pinnedCoordinate}`}
          title={i18n.t("Remove pinned coordinate")}
          onClick={clearPinnedCoordinate}
        >
          <MapPin size={24} aria-hidden="true" />
        </button>
      )}

      <div className={`map-coordinate ${coordinateKind}`}>
        <LocateFixed size={13} />
        <span>{displayedCoordinate}</span>
        {selectedCoordinate || pinnedCoordinate ? (
          <button
            type="button"
            onClick={() => {
              void copyTextToClipboard(displayedCoordinate).then((copied) => {
                if (!copied) {
                  setMapExportError(
                    i18n.t(
                      "The browser denied clipboard access. Select the coordinate text and copy it manually.",
                    ),
                  );
                }
              });
            }}
            title={
              selectedCoordinate
                ? i18n.t("Copy selected cell coordinate")
                : i18n.t("Copy pinned coordinate")
            }
          >
            {i18n.t("Copy").toUpperCase()}
          </button>
        ) : (
          <small>
            {pinPlacementActive
              ? i18n.t("Click empty map space to set pin").toUpperCase()
              : i18n.t("Click a cell to select · use pin tool for GPS").toUpperCase()}
          </small>
        )}
      </div>
      {(measureModeActive || measurementPoints.length > 0) && (
        <div className="diagnostic-overlay measure-overlay">
          <Ruler size={13} />
          <span>{i18n.t("Measure")}</span>
          <strong>
            {measurementPoints.length > 1
              ? formatMeasurementDistance(totalMeasuredDistance, i18n)
              : i18n.t("Add points to measure total distance")}
          </strong>
          {measurementPoints.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <strong>{i18n.t("counts.points", { count: measurementPoints.length })}</strong>
              <button
                type="button"
                onClick={clearMeasurement}
                title={i18n.t("Clear measurement")}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
      <div className="diagnostic-overlay">
        <ScanLine size={13} />
        <span>{i18n.t("Binary layout")}</span>
        <strong>{grid.bytesPerCell} B/cell</strong>
        {cellAreaSquareMeters !== undefined && cellDimensionsMeters && (
          <>
            <span aria-hidden="true">·</span>
            <strong>
              {grid.cellSizeUnit === "degrees" ? "≈" : ""}
              {formatCellLength(cellDimensionsMeters.northSouth)} ×{" "}
              {formatCellLength(cellDimensionsMeters.eastWest)} m ·{" "}
              {formatCellArea(cellAreaSquareMeters)} m²/cell
            </strong>
          </>
        )}
      </div>
    </main>
  );
}
