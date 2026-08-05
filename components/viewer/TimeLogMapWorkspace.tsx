"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, TileLayer } from "leaflet";
import {
  AlertTriangle,
  Check,
  Crosshair,
  Filter,
  Layers,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Route,
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/client/clipboard";
import { decodeValue } from "@/lib/isoxml/value-decoder";
import { extremeOutlierBounds } from "@/lib/isoxml/outliers";
import {
  classIndexForValue,
  classifyValues,
} from "@/lib/isoxml/value-classification";
import type {
  DecodedTimeLog,
  IsoXmlDataset,
  TimeLogChannel,
} from "@/lib/isoxml/types";
import { useViewerStore } from "./store";
import { executedOutlierControlLabel } from "./map-control-labels";
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
import { webMercatorWorldPixel } from "./map-rendering";

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
  const [baseLayerMenuOpen, setBaseLayerMenuOpen] = useState(false);
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
  const selectedRecordIndex = useViewerStore(
    (state) => state.selectedCellIndex,
  );
  const setSelectedRecord = useViewerStore((state) => state.setSelectedCell);
  const baseLayer = useViewerStore((state) => state.baseLayer);
  const initialBaseLayerRef = useRef(baseLayer);
  const setBaseLayer = useViewerStore((state) => state.setBaseLayer);
  const hideOutliers = useViewerStore((state) => state.hideOutliers);
  const setHideOutliers = useViewerStore((state) => state.setHideOutliers);
  const mapFitNonce = useViewerStore((state) => state.mapFitNonce);
  const channelIndex = timeLog.channels.findIndex(
    (candidate) => candidate.channelId === channel.channelId,
  );

  const setPinPlacementMode = useCallback((active: boolean) => {
    pinPlacementActiveRef.current = active;
    setPinPlacementActive(active);
  }, []);

  const clearPinnedCoordinate = useCallback(() => {
    pinnedLatLngRef.current = undefined;
    setPinnedCoordinate(undefined);
    setPinnedScreenPosition(undefined);
  }, []);

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
  const excludedMask = useMemo(() => {
    if (!hideOutliers) return new Uint8Array(numericValues.length);
    return outlierMask;
  }, [hideOutliers, numericValues.length, outlierMask]);
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

    const radius = Math.max(3, Math.min(6, map.getZoom() - 12));
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
    const occupiedDensityBuckets = new Uint8Array(densityColumns * densityRows);
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
        Math.min(densityColumns - 1, Math.floor((x + 10) / densityBucketSize)),
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
    context.globalAlpha = 0.9;
    paths.forEach((path, index) => {
      context.fillStyle = classColors[index] ?? "#526059";
      context.fill(path);
      if (renderedPointCount <= 12_000) {
        context.strokeStyle = "rgba(8, 18, 16, 0.55)";
        context.lineWidth = 0.7;
        context.stroke(path);
      }
    });
    pointHitBucketsRef.current = hitBuckets;

    if (
      selectedRecordIndex !== undefined &&
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
      setSelectedScreenPosition((current) =>
        current && current.x === point.x && current.y === point.y
          ? current
          : { x: point.x, y: point.y },
      );
    } else {
      setSelectedScreenPosition(undefined);
    }
  }, [
    classColors,
    classification,
    dataset.boundaries,
    numericValues,
    pointRecordIndexes,
    pointWorldPixels,
    selectedRecordIndex,
  ]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let redrawFrame: number | undefined;
    let hoverFrame: number | undefined;
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
      if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
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
  const outlierCount = outlierMask.reduce(
    (count, outlier) => count + outlier,
    0,
  );
  const outlierControlLabel = executedOutlierControlLabel(
    hideOutliers,
    outlierCount,
  );
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
        <button
          type="button"
          className={hideOutliers ? "active" : ""}
          onClick={() => setHideOutliers(!hideOutliers)}
          aria-label={outlierControlLabel}
          aria-pressed={hideOutliers}
          title={outlierControlLabel}
          data-tooltip={outlierControlLabel}
        >
          <Filter size={16} />
        </button>
        <div className="basemap-control">
          <button
            type="button"
            onClick={() => setBaseLayerMenuOpen((open) => !open)}
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
