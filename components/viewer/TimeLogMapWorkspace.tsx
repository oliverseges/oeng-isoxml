"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Route,
  Scan,
  SlidersHorizontal,
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import { downloadBlob } from "@/lib/isoxml/export";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import { extremeOutlierBounds } from "@/lib/isoxml/outliers";
import { buildExecutedMapExcludedMask } from "@/lib/isoxml/time-log-map-filters";
import {
  classIndexForValue,
  classifyValues,
} from "@/lib/isoxml/value-classification";
import type {
  DecodedTimeLog,
  IsoXmlDataset,
  SpatialBoundary,
  TimeLogChannel,
} from "@/lib/isoxml/types";
import { useViewerStore } from "./store";
import {
  BASEMAP_ZOOM_OPTIONS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from "./map-options";
import {
  addMapPointHitTarget,
  displayedMapRecordIndex,
  nearestMapPointIndex,
  type MapPointHitBuckets,
} from "./map-hit-testing";
import {
  timeLogPointRenderStyle,
  webMercatorWorldPixel,
} from "./map-rendering";
import { drawMapScreenshotTooltip } from "./map-screenshot";

const colorStops = [
  "#176b48",
  "#3c8c55",
  "#8faf54",
  "#d5bf4b",
  "#dc873d",
  "#be3d48",
  "#8d1536",
];
const ZOOM_STEP = 0.25;

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
  const amount = scaled - index;
  const left = hexToRgb(colorStops[index]);
  const right = hexToRgb(colorStops[index + 1]);
  return `rgb(${left.map((component, part) => Math.round(component + (right[part] - component) * amount)).join(",")})`;
}

function colorsForClasses(classCount: number): string[] {
  if (classCount <= 0) return [];
  if (classCount === 1) return [interpolatedColor(0.5)];
  return Array.from({ length: classCount }, (_, index) =>
    interpolatedColor(index / (classCount - 1)),
  );
}

function traceBoundary(
  context: CanvasRenderingContext2D,
  map: LeafletMap,
  coordinates: Array<[number, number]>,
): void {
  context.beginPath();
  coordinates.forEach(([latitude, longitude], index) => {
    const point = map.latLngToContainerPoint([latitude, longitude]);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
}

function fieldBoundaryForTimeLog(
  dataset: IsoXmlDataset,
  timeLog: DecodedTimeLog,
  activeBoundaryId?: string,
): SpatialBoundary | undefined {
  const task = dataset.tasks.find(
    (candidate) => candidate.instanceId === timeLog.taskInstanceId,
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
        boundary.id === activeBoundaryId && boundary.taskId === timeLog.taskId,
    ) ??
    dataset.boundaries.find((boundary) => boundary.taskId === timeLog.taskId) ??
    dataset.boundaries.find((boundary) => boundary.id === fieldId) ??
    (dataset.boundaries.length === 1 ? dataset.boundaries[0] : undefined)
  );
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
  channel: TimeLogChannel,
  min: number,
  max: number,
  pointCount: number,
  classColors: readonly string[],
): void {
  const panelWidth = Math.min(240, width - 28);
  const panelHeight = 162;
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

  context.fillStyle = "#c7d955";
  context.fillRect(innerX, y + 13, 8, 8);
  context.fillStyle = "#8f9d96";
  context.font = '8px Consolas, "SFMono-Regular", monospace';
  context.textBaseline = "top";
  context.fillText("EXECUTED · ACTIVE", innerX + 14, y + 13);

  context.fillStyle = "#dce5df";
  context.font = "600 14px Inter, Arial, sans-serif";
  context.fillText(
    fittedCanvasText(
      context,
      channel.deviceElementName ?? "Device element unresolved",
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
    fittedCanvasText(context, channel.unit ?? "unit unknown", innerWidth / 2),
    innerX + innerWidth / 2,
    rampY + 13,
  );

  context.strokeStyle = "rgba(197, 214, 204, 0.16)";
  context.beginPath();
  context.moveTo(innerX, y + 109.5);
  context.lineTo(innerX + innerWidth, y + 109.5);
  context.stroke();

  const rows = [
    ["Machine", channel.deviceName ?? "Unresolved"],
    ["Visible points", pointCount.toLocaleString("en-US")],
  ];
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

interface TimeLogMapWorkspaceProps {
  dataset: IsoXmlDataset;
  timeLog: DecodedTimeLog;
  channel: TimeLogChannel;
}

export function TimeLogMapWorkspace({
  dataset,
  timeLog,
  channel,
}: TimeLogMapWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const tileLayerRef = useRef<TileLayer | undefined>(undefined);
  const leafletRef = useRef<typeof import("leaflet") | undefined>(undefined);
  const drawRef = useRef<() => void>(() => {});
  const pointHitBucketsRef = useRef<MapPointHitBuckets>(new Map());
  const pinnedLatLngRef = useRef<
    { latitude: number; longitude: number } | undefined
  >(undefined);
  const pinPlacementActiveRef = useRef(false);
  const displayFilterControlRef = useRef<HTMLDivElement>(null);
  const baseLayerControlRef = useRef<HTMLDivElement>(null);
  const [baseLayerMenuOpen, setBaseLayerMenuOpen] = useState(false);
  const [displayFilterMenuOpen, setDisplayFilterMenuOpen] = useState(false);
  const [liveCoordinate, setLiveCoordinate] = useState("Move over the map");
  const [pinnedCoordinate, setPinnedCoordinate] = useState<string>();
  const [pinnedScreenPosition, setPinnedScreenPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [pinPlacementActive, setPinPlacementActive] = useState(false);
  const [hoveredRecordIndex, setHoveredRecordIndex] = useState<number>();
  const [hoverScreenPosition, setHoverScreenPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [selectedScreenPosition, setSelectedScreenPosition] = useState<{
    x: number;
    y: number;
  }>();
  const [mapExportError, setMapExportError] = useState<string>();
  const selectedRecordIndex = useViewerStore(
    (state) => state.selectedCellIndex,
  );
  const setSelectedRecord = useViewerStore((state) => state.setSelectedCell);
  const baseLayer = useViewerStore((state) => state.baseLayer);
  const initialBaseLayerRef = useRef(baseLayer);
  const setBaseLayer = useViewerStore((state) => state.setBaseLayer);
  const hideEmptyCells = useViewerStore((state) => state.hideEmptyCells);
  const setHideEmptyCells = useViewerStore((state) => state.setHideEmptyCells);
  const hideOutliers = useViewerStore((state) => state.hideOutliers);
  const setHideOutliers = useViewerStore((state) => state.setHideOutliers);
  const clipToField = useViewerStore((state) => state.clipToField);
  const setClipToField = useViewerStore((state) => state.setClipToField);
  const activeBoundaryId = useViewerStore((state) => state.activeBoundaryId);
  const mapFitNonce = useViewerStore((state) => state.mapFitNonce);
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );
  const fieldBoundary = useMemo(
    () => fieldBoundaryForTimeLog(dataset, timeLog, activeBoundaryId),
    [activeBoundaryId, dataset, timeLog],
  );
  const fieldClipActive = clipToField && Boolean(fieldBoundary);
  const activeDisplayFilterCount =
    Number(hideEmptyCells) + Number(hideOutliers) + Number(fieldClipActive);

  const setPinPlacementMode = useCallback((active: boolean) => {
    pinPlacementActiveRef.current = active;
    setPinPlacementActive(active);
  }, []);

  const clearPinnedCoordinate = useCallback(() => {
    pinnedLatLngRef.current = undefined;
    setPinnedCoordinate(undefined);
    setPinnedScreenPosition(undefined);
  }, []);

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

  const numericValues = useMemo(() => {
    const values = new Float64Array(timeLog.decodedRecordCount);
    values.fill(Number.NaN);
    const rawValues = timeLog.rawValues[channelIndex];
    const present = timeLog.valuePresent[channelIndex];
    if (!rawValues || !present) return values;
    for (let index = 0; index < values.length; index += 1) {
      if (!present[index] || !timeLog.validPositions[index]) continue;
      values[index] =
        decodeValue(rawValues[index], channel.presentation).numericValue ??
        Number.NaN;
    }
    return values;
  }, [channel.presentation, channelIndex, timeLog]);

  const outlierMask = useMemo(() => {
    const values = Array.from(numericValues).filter(Number.isFinite);
    const bounds = extremeOutlierBounds(values);
    const mask = new Uint8Array(numericValues.length);
    if (!bounds) return mask;
    for (let index = 0; index < mask.length; index += 1) {
      const value = numericValues[index];
      if (
        Number.isFinite(value) &&
        (value < bounds.lower || value > bounds.upper)
      ) {
        mask[index] = 1;
      }
    }
    return mask;
  }, [numericValues]);
  const excludedMask = useMemo(
    () =>
      buildExecutedMapExcludedMask(
        numericValues,
        outlierMask,
        timeLog.latitudes,
        timeLog.longitudes,
        {
          hideZeroValues: hideEmptyCells,
          hideOutliers,
          clipToField: fieldClipActive,
          fieldBoundary,
        },
      ),
    [
      fieldBoundary,
      fieldClipActive,
      hideEmptyCells,
      hideOutliers,
      numericValues,
      outlierMask,
      timeLog.latitudes,
      timeLog.longitudes,
    ],
  );
  const classification = useMemo(
    () => classifyValues(numericValues, 10, excludedMask),
    [excludedMask, numericValues],
  );
  const classColors = useMemo(
    () => colorsForClasses(classification.classCount),
    [classification.classCount],
  );
  const pointRecordIndexes = useMemo(() => {
    const indexes: number[] = [];
    for (let index = 0; index < numericValues.length; index += 1) {
      if (Number.isFinite(numericValues[index]) && !excludedMask[index]) {
        indexes.push(index);
      }
    }
    return indexes;
  }, [excludedMask, numericValues]);
  const pointWorldPixels = useMemo(() => {
    const x = new Float64Array(numericValues.length);
    const y = new Float64Array(numericValues.length);
    x.fill(Number.NaN);
    y.fill(Number.NaN);
    for (let index = 0; index < numericValues.length; index += 1) {
      if (!Number.isFinite(numericValues[index])) continue;
      const point = webMercatorWorldPixel(
        timeLog.latitudes[index],
        timeLog.longitudes[index],
      );
      x[index] = point.x;
      y[index] = point.y;
    }
    return { x, y };
  }, [numericValues, timeLog.latitudes, timeLog.longitudes]);

  const fitTimeLog = useCallback(() => {
    const map = mapRef.current;
    if (!map || !timeLog.bbox) return;
    const [west, south, east, north] = timeLog.bbox;
    map.stop();
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [54, 54], animate: false, maxZoom: 20 },
    );
  }, [timeLog.bbox]);

  const paintDataLayer = useCallback(
    (
      context: CanvasRenderingContext2D,
      map: LeafletMap,
      size: { x: number; y: number },
      includeSelection: boolean,
      interactive: boolean,
    ) => {
      context.save();
      dataset.boundaries.forEach((boundary) => {
        if (boundary.coordinates.length < 2) return;
        traceBoundary(context, map, boundary.coordinates);
        context.strokeStyle = "#d5e59d";
        context.setLineDash([7, 5]);
        context.lineWidth = 1.5;
        context.stroke();
      });
      context.setLineDash([]);
      context.restore();

      const pointStyle = timeLogPointRenderStyle(map.getZoom());
      const radius = pointStyle.radius;
      const hitBuckets: MapPointHitBuckets = new Map();
      const zoomScale = 2 ** map.getZoom();
      const worldOrigin = map.latLngToContainerPoint([0, 0]);
      const offsetX = worldOrigin.x - 128 * zoomScale;
      const offsetY = worldOrigin.y - 128 * zoomScale;
      const densityBucketSize =
        pointRecordIndexes.length > 10_000
          ? Math.max(4, Math.ceil(radius * 1.75))
          : 1;
      const densityColumns = Math.max(
        1,
        Math.ceil((size.x + 20) / densityBucketSize),
      );
      const densityRows = Math.max(
        1,
        Math.ceil((size.y + 20) / densityBucketSize),
      );
      const occupiedDensityBuckets = new Uint8Array(
        densityColumns * densityRows,
      );
      const paths = Array.from(
        { length: Math.max(1, classColors.length) },
        () => new Path2D(),
      );
      let renderedPointCount = 0;
      for (const recordIndex of pointRecordIndexes) {
        const x = pointWorldPixels.x[recordIndex] * zoomScale + offsetX;
        const y = pointWorldPixels.y[recordIndex] * zoomScale + offsetY;
        if (x < -10 || y < -10 || x > size.x + 10 || y > size.y + 10) {
          continue;
        }
        const densityColumn = Math.max(
          0,
          Math.min(
            densityColumns - 1,
            Math.floor((x + 10) / densityBucketSize),
          ),
        );
        const densityRow = Math.max(
          0,
          Math.min(densityRows - 1, Math.floor((y + 10) / densityBucketSize)),
        );
        const densityIndex = densityRow * densityColumns + densityColumn;
        if (occupiedDensityBuckets[densityIndex]) continue;
        occupiedDensityBuckets[densityIndex] = 1;
        renderedPointCount += 1;
        addMapPointHitTarget(hitBuckets, { recordIndex, x, y });
        const classIndex = classIndexForValue(
          numericValues[recordIndex],
          classification,
        );
        const path = paths[classIndex ?? 0];
        path.moveTo(x + radius, y);
        path.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.globalAlpha = pointStyle.fillAlpha;
      paths.forEach((path, index) => {
        context.fillStyle = classColors[index] ?? "#526059";
        context.fill(path);
        if (renderedPointCount <= 12_000 && pointStyle.borderAlpha > 0) {
          context.globalAlpha = pointStyle.borderAlpha;
          context.strokeStyle = "#081210";
          context.lineWidth = pointStyle.borderWidth;
          context.stroke(path);
          context.globalAlpha = pointStyle.fillAlpha;
        }
      });
      if (interactive) pointHitBucketsRef.current = hitBuckets;

      if (
        includeSelection &&
        selectedRecordIndex !== undefined &&
        !excludedMask[selectedRecordIndex] &&
        Number.isFinite(numericValues[selectedRecordIndex])
      ) {
        const point = {
          x: pointWorldPixels.x[selectedRecordIndex] * zoomScale + offsetX,
          y: pointWorldPixels.y[selectedRecordIndex] * zoomScale + offsetY,
        };
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
        context.strokeStyle = "#f3f7ed";
        context.lineWidth = 2;
        context.stroke();
        if (interactive) {
          setSelectedScreenPosition((current) =>
            current && current.x === point.x && current.y === point.y
              ? current
              : { x: point.x, y: point.y },
          );
        }
      } else if (interactive) {
        setSelectedScreenPosition(undefined);
      }
    },
    [
      classColors,
      classification,
      dataset.boundaries,
      excludedMask,
      numericValues,
      pointRecordIndexes,
      pointWorldPixels,
      selectedRecordIndex,
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
    paintDataLayer(context, map, size, true, true);
  }, [paintDataLayer]);

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
      if (timeLog.bbox) {
        const [west, south, east, north] = timeLog.bbox;
        map.fitBounds(
          [
            [south, west],
            [north, east],
          ],
          { padding: [54, 54], animate: false, maxZoom: 20 },
        );
      } else map.setView([20, 0], 2);
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
      }
      tileLayerRef.current?.bringToBack();

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
        | {
            latitude: number;
            longitude: number;
            x: number;
            y: number;
          }
        | undefined;
      const updateHover = () => {
        hoverFrame = undefined;
        const hover = pendingHover;
        if (!hover) return;
        pendingHover = undefined;
        setLiveCoordinate(
          `${hover.latitude.toFixed(6)}, ${hover.longitude.toFixed(6)}`,
        );
        const recordIndex = nearestMapPointIndex(pointHitBucketsRef.current, {
          x: hover.x,
          y: hover.y,
        });
        setHoveredRecordIndex(recordIndex);
        setHoverScreenPosition(
          recordIndex === undefined
            ? undefined
            : { x: hover.x + 14, y: hover.y + 14 },
        );
      };
      const clearHover = () => {
        pendingHover = undefined;
        if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
        hoverFrame = undefined;
        setHoveredRecordIndex(undefined);
        setHoverScreenPosition(undefined);
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
        const recordIndex = nearestMapPointIndex(
          pointHitBucketsRef.current,
          event.containerPoint,
        );
        if (recordIndex !== undefined) {
          clearPinnedCoordinate();
          setPinPlacementMode(false);
          setSelectedRecord(recordIndex);
          return;
        }
        if (pinPlacementActiveRef.current) {
          setSelectedRecord(undefined);
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
        setSelectedRecord(undefined);
      });
      redraw();
    });
    return () => {
      disposed = true;
      if (redrawFrame !== undefined) cancelAnimationFrame(redrawFrame);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
      resizeObserver?.disconnect();
      setSelectedScreenPosition(undefined);
      setHoveredRecordIndex(undefined);
      setHoverScreenPosition(undefined);
      pointHitBucketsRef.current.clear();
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
    setPinPlacementMode,
    setSelectedRecord,
    timeLog.bbox,
  ]);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      clearPinnedCoordinate();
      setPinPlacementMode(false);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [clearPinnedCoordinate, setPinPlacementMode, timeLog.instanceId]);

  useEffect(() => {
    if (selectedRecordIndex === undefined) return;
    const animationFrame = requestAnimationFrame(() => {
      clearPinnedCoordinate();
      setPinPlacementMode(false);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [clearPinnedCoordinate, selectedRecordIndex, setPinPlacementMode]);

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
    }
    tileLayerRef.current?.bringToBack();
  }, [baseLayer]);

  useEffect(() => {
    if (mapFitNonce > 0) fitTimeLog();
  }, [fitTimeLog, mapFitNonce]);

  const outlierCount = outlierMask.reduce(
    (count, outlier) => count + outlier,
    0,
  );
  const zeroValueCount = numericValues.reduce(
    (count, value) => count + Number(value === 0),
    0,
  );

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

      paintDataLayer(context, map, size, true, false);
      drawExportLegend(
        context,
        size.x,
        channel,
        classification.min,
        classification.max,
        pointRecordIndexes.length,
        classColors,
      );

      if (
        selectedRecordIndex !== undefined &&
        !excludedMask[selectedRecordIndex] &&
        Number.isFinite(numericValues[selectedRecordIndex])
      ) {
        const anchor = map.latLngToContainerPoint([
          timeLog.latitudes[selectedRecordIndex],
          timeLog.longitudes[selectedRecordIndex],
        ]);
        if (
          anchor.x >= 0 &&
          anchor.y >= 0 &&
          anchor.x <= size.x &&
          anchor.y <= size.y
        ) {
          const selectedValue = decodeValue(
            timeLog.rawValues[channelIndex][selectedRecordIndex],
            channel.presentation,
          );
          drawMapScreenshotTooltip(context, size.x, size.y, {
            anchor,
            headerLabel: "RECORD",
            headerValue: `#${selectedRecordIndex + 1}`,
            formattedValue: selectedValue.formattedValue,
            unit: channel.unit,
            rows: [
              {
                label: "Time",
                value: new Date(
                  timeLog.timestamps[selectedRecordIndex],
                ).toLocaleTimeString(),
              },
              { label: "Raw", value: String(selectedValue.rawValue) },
            ],
          });
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
      downloadBlob(blob, `${timeLog.id}-${channel.ddiDisplay}-map.png`);
    } catch (error) {
      console.error("Executed map export failed.", error);
      setMapExportError(
        baseLayer === "none"
          ? "The map image could not be exported."
          : "The browser blocked pixels from the background map. Choose No background and try again.",
      );
    }
  };

  const tooltipRecordIndex = displayedMapRecordIndex(
    hoveredRecordIndex,
    selectedRecordIndex,
  );
  const tooltipValue =
    tooltipRecordIndex === undefined ||
    !timeLog.valuePresent[channelIndex]?.[tooltipRecordIndex]
      ? undefined
      : decodeValue(
          timeLog.rawValues[channelIndex][tooltipRecordIndex],
          channel.presentation,
        );
  const tooltipScreenPosition =
    hoveredRecordIndex !== undefined
      ? hoverScreenPosition
      : selectedScreenPosition && {
          x: selectedScreenPosition.x + 14,
          y: selectedScreenPosition.y + 14,
        };
  const selectedCoordinate =
    selectedRecordIndex !== undefined &&
    timeLog.validPositions[selectedRecordIndex] &&
    Number.isFinite(timeLog.latitudes[selectedRecordIndex]) &&
    Number.isFinite(timeLog.longitudes[selectedRecordIndex])
      ? `${timeLog.latitudes[selectedRecordIndex].toFixed(6)}, ${timeLog.longitudes[selectedRecordIndex].toFixed(6)}`
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
      className={`map-workspace${pinPlacementActive ? " pin-placement-active" : ""}`}
      aria-label="Executed ISOXML time-log map"
    >
      <div
        className="map-container"
        ref={containerRef}
        data-testid="timelog-map"
      />
      <div className="map-control-stack top-left">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn(ZOOM_STEP, { animate: false })}
          aria-label="Zoom in"
          title="Zoom in"
          data-tooltip="Zoom in"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut(ZOOM_STEP, { animate: false })}
          aria-label="Zoom out"
          title="Zoom out"
          data-tooltip="Zoom out"
        >
          <Minus size={16} />
        </button>
        <span />
        <button
          type="button"
          onClick={fitTimeLog}
          aria-label="Fit executed points to the map"
          title="Fit executed points to the map"
          data-tooltip="Fit executed points to the map"
        >
          <Crosshair size={16} />
        </button>
        <button
          type="button"
          className={pinPlacementActive ? "active" : ""}
          onClick={() => setPinPlacementMode(!pinPlacementActive)}
          aria-label={
            pinPlacementActive
              ? "Cancel coordinate pin placement"
              : "Place a coordinate pin"
          }
          aria-pressed={pinPlacementActive}
          title={
            pinPlacementActive
              ? "Cancel coordinate pin placement"
              : "Place a coordinate pin on empty map space"
          }
          data-tooltip={
            pinPlacementActive
              ? "Cancel coordinate pin placement"
              : "Place a coordinate pin"
          }
        >
          <MapPin size={16} />
        </button>
        <div className="map-filter-control" ref={displayFilterControlRef}>
          <button
            type="button"
            className={activeDisplayFilterCount ? "active" : ""}
            aria-label={`Configure map display filters${activeDisplayFilterCount ? `: ${activeDisplayFilterCount} active` : ""}`}
            aria-expanded={displayFilterMenuOpen}
            title={`Map display filters${activeDisplayFilterCount ? ` (${activeDisplayFilterCount} active)` : ""}`}
            data-tooltip={`Map display filters${activeDisplayFilterCount ? ` (${activeDisplayFilterCount} active)` : ""}`}
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
              aria-label="Map display filters"
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
                  <strong>Hide zero values</strong>
                  <small>
                    {zeroValueCount
                      ? `${zeroValueCount.toLocaleString()} displayed zeros`
                      : "No displayed zeros"}
                  </small>
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
                  <strong>Cut to field</strong>
                  <small>
                    {fieldBoundary?.name ?? "No field boundary available"}
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
                  <strong>Hide outliers</strong>
                  <small title="Extreme values beyond 3× IQR, with a minimum 50% typical-value guard">
                    {outlierCount
                      ? `${outlierCount} extreme · conservative 3× IQR`
                      : "None detected · conservative 3× IQR"}
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
            aria-label="Choose background map"
            aria-expanded={baseLayerMenuOpen}
            className={baseLayer !== "none" ? "active" : ""}
            title="Choose background map"
            data-tooltip="Choose background map"
          >
            <Layers size={16} />
          </button>
          {baseLayerMenuOpen && (
            <div
              className="basemap-menu"
              role="menu"
              aria-label="Background map"
            >
              {(
                [
                  ["none", "No background"],
                  ["streets", "Streets"],
                  ["satellite", "Satellite"],
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
                  {baseLayer === id && <b>ON</b>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void exportMap()}
          aria-label="Export map screenshot"
          title="Export map screenshot"
          data-tooltip="Export map screenshot"
        >
          <Scan size={16} />
        </button>
      </div>

      <div className="map-badge top-center">
        <span className="pulse-dot" />
        TYPE {timeLog.timeLogType} TIME LOG ·{" "}
        {timeLog.decodedRecordCount.toLocaleString()} RECORDS · CANVAS
      </div>

      {!timeLog.validPositionCount && (
        <div className="map-spatial-error" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>No valid recorded positions</strong>
            <span>
              The executed values remain available in the record table.
            </span>
          </div>
        </div>
      )}

      {mapExportError && (
        <div className="map-export-error" role="alert">
          <AlertTriangle size={15} />
          <span>{mapExportError}</span>
          <button type="button" onClick={() => setMapExportError(undefined)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="map-legend" aria-label="Executed layer legend">
        <div className="legend-kicker">
          <span className="layer-swatch executed" />
          EXECUTED · ACTIVE
        </div>
        <h2>{channel.deviceElementName ?? "Device element unresolved"}</h2>
        <p>
          DDI {channel.ddiDisplay} · {channel.ddiName}
        </p>
        <div className="legend-ramp" aria-hidden="true">
          {classColors.map((color, index) => (
            <span key={`${color}-${index}`} style={{ background: color }} />
          ))}
        </div>
        <div className="legend-range">
          <span>
            {classification.min.toFixed(channel.presentation.decimals)}
          </span>
          <strong>{channel.unit ?? "unit unknown"}</strong>
          <span>
            {classification.max.toFixed(channel.presentation.decimals)}
          </span>
        </div>
        <dl>
          <div>
            <dt>Machine</dt>
            <dd>{channel.deviceName ?? "Unresolved"}</dd>
          </div>
          <div>
            <dt>Visible points</dt>
            <dd>{pointRecordIndexes.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Outliers</dt>
            <dd>{outlierCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{timeLog.filename}</dd>
          </div>
        </dl>
      </section>

      {tooltipValue &&
        tooltipRecordIndex !== undefined &&
        tooltipScreenPosition && (
          <div
            className="map-tooltip timelog-selection"
            style={{
              left: tooltipScreenPosition.x,
              top: tooltipScreenPosition.y,
            }}
            role={hoveredRecordIndex !== undefined ? "tooltip" : "status"}
          >
            <div className="tooltip-header">
              <span>RECORD</span>
              <strong>#{tooltipRecordIndex + 1}</strong>
            </div>
            <div className="tooltip-value">
              {tooltipValue.formattedValue}
              <small>{channel.unit}</small>
            </div>
            <dl>
              <div>
                <dt>Time</dt>
                <dd>
                  {new Date(
                    timeLog.timestamps[tooltipRecordIndex],
                  ).toLocaleTimeString()}
                </dd>
              </div>
              <div>
                <dt>Raw</dt>
                <dd>{tooltipValue.rawValue}</dd>
              </div>
            </dl>
            {hoveredRecordIndex !== undefined && (
              <span className="tooltip-hint">
                Click to keep this record selected
              </span>
            )}
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
          aria-label={`Remove pinned coordinate ${pinnedCoordinate}`}
          title="Remove pinned coordinate"
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
            onClick={() => void copyTextToClipboard(displayedCoordinate)}
            title={
              selectedCoordinate
                ? "Copy selected record coordinate"
                : "Copy pinned coordinate"
            }
          >
            COPY
          </button>
        ) : (
          <small>
            {pinPlacementActive
              ? "CLICK EMPTY MAP SPACE TO SET PIN"
              : "HOVER FOR DETAILS · CLICK A POINT TO SELECT"}
          </small>
        )}
      </div>
      <div className="diagnostic-overlay">
        <Route size={13} />
        <span>Executed path</span>
        <strong>{timeLog.validPositionCount.toLocaleString()} positions</strong>
        {hideOutliers && outlierCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <strong>
              <Check size={12} /> {outlierCount} hidden
            </strong>
          </>
        )}
      </div>
    </main>
  );
}
