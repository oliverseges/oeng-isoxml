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
  Minus,
  Plus,
  Route,
} from "lucide-react";
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
  const [baseLayerMenuOpen, setBaseLayerMenuOpen] = useState(false);
  const [liveCoordinate, setLiveCoordinate] = useState("Move over the map");
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
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
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
    pointRecordIndexes.forEach((recordIndex) => {
      const point = map.latLngToContainerPoint([
        timeLog.latitudes[recordIndex],
        timeLog.longitudes[recordIndex],
      ]);
      if (
        point.x >= -10 &&
        point.y >= -10 &&
        point.x <= size.x + 10 &&
        point.y <= size.y + 10
      ) {
        addMapPointHitTarget(hitBuckets, {
          recordIndex,
          x: point.x,
          y: point.y,
        });
      }
      const classIndex = classIndexForValue(
        numericValues[recordIndex],
        classification,
      );
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle =
        classIndex === undefined ? "#526059" : classColors[classIndex];
      context.globalAlpha = 0.9;
      context.fill();
      context.strokeStyle = "rgba(8, 18, 16, 0.55)";
      context.lineWidth = 0.7;
      context.stroke();
    });
    pointHitBucketsRef.current = hitBuckets;

    if (
      selectedRecordIndex !== undefined &&
      Number.isFinite(numericValues[selectedRecordIndex])
    ) {
      const point = map.latLngToContainerPoint([
        timeLog.latitudes[selectedRecordIndex],
        timeLog.longitudes[selectedRecordIndex],
      ]);
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
    selectedRecordIndex,
    timeLog.latitudes,
    timeLog.longitudes,
  ]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
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
      map.on("move zoom resize", () => drawRef.current());
      map.on("mousemove", (event) => {
        setLiveCoordinate(
          `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`,
        );
        const recordIndex = nearestMapPointIndex(
          pointHitBucketsRef.current,
          event.containerPoint,
        );
        setHoveredRecordIndex(recordIndex);
        setHoverScreenPosition(
          recordIndex === undefined
            ? undefined
            : {
                x: event.containerPoint.x + 14,
                y: event.containerPoint.y + 14,
              },
        );
      });
      map.on("mouseout movestart zoomstart", () => {
        setHoveredRecordIndex(undefined);
        setHoverScreenPosition(undefined);
      });
      map.on("click", (event) => {
        setSelectedRecord(
          nearestMapPointIndex(
            pointHitBucketsRef.current,
            event.containerPoint,
          ),
        );
      });
      requestAnimationFrame(() => drawRef.current());
    });
    return () => {
      disposed = true;
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
  }, [setSelectedRecord, timeLog.bbox]);

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

  return (
    <main className="map-workspace" aria-label="Executed ISOXML time-log map">
      <div className="map-container" ref={containerRef} />
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

      <div className="map-coordinate live">
        <LocateFixed size={13} />
        <span>{liveCoordinate}</span>
        <small>HOVER FOR DETAILS · CLICK TO SELECT</small>
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
