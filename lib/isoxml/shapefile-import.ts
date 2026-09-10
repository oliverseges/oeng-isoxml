import JSZip from "jszip";
import { basename, hexPreview, sha256 } from "./file-loader";
import { issue } from "./object-model";
import type {
  FileManifestEntry,
  IsoXmlDataset,
  SpatialBoundary,
} from "./types";

interface ParsedShapefileGeometry {
  type: string;
  coordinates: unknown;
}

interface ParsedShapefileFeature {
  type: "Feature";
  geometry: ParsedShapefileGeometry | null;
  properties?: Record<string, unknown> | null;
}

interface ParsedShapefileCollection {
  type: "FeatureCollection";
  fileName?: string;
  features: ParsedShapefileFeature[];
}

export interface ShapefileImportFile {
  name: string;
  bytes: Uint8Array;
}

function sourceArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

function namedProperty(
  properties: Record<string, unknown> | null | undefined,
): string | undefined {
  for (const key of ["name", "Name", "title", "Title"]) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function ringToBoundaryCoordinates(
  ring: unknown,
): Array<[latitude: number, longitude: number]> {
  if (!Array.isArray(ring)) return [];
  return ring.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return [];
    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return [];
    }
    return [[latitude, longitude] as [number, number]];
  });
}

function boundaryFromFeature(
  feature: ParsedShapefileFeature,
  fallbackName: string,
  taskId: string | undefined,
  sourceKey: string,
  featureIndex: number,
): { boundary?: SpatialBoundary; ignoredParts: number } {
  if (!feature.geometry) return { ignoredParts: 0 };

  if (feature.geometry.type === "Polygon") {
    const polygons = feature.geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) {
      return { ignoredParts: 0 };
    }
    const coordinates = ringToBoundaryCoordinates(polygons[0]);
    if (coordinates.length < 3) return { ignoredParts: 0 };
    return {
      boundary: {
        id: `${sourceKey}:polygon:${featureIndex}`,
        name: namedProperty(feature.properties) ?? fallbackName,
        taskId,
        coordinates,
        sourceObjectUid: `${sourceKey}:polygon:${featureIndex}`,
      },
      ignoredParts: Math.max(0, polygons.length - 1),
    };
  }

  if (feature.geometry.type === "MultiPolygon") {
    const polygons = feature.geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) {
      return { ignoredParts: 0 };
    }
    const firstPolygon = polygons[0];
    if (!Array.isArray(firstPolygon) || !firstPolygon.length) {
      return { ignoredParts: 0 };
    }
    const coordinates = ringToBoundaryCoordinates(firstPolygon[0]);
    if (coordinates.length < 3) return { ignoredParts: 0 };
    return {
      boundary: {
        id: `${sourceKey}:multipolygon:${featureIndex}`,
        name: namedProperty(feature.properties) ?? fallbackName,
        taskId,
        coordinates,
        sourceObjectUid: `${sourceKey}:multipolygon:${featureIndex}`,
      },
      ignoredParts:
        Math.max(0, polygons.length - 1) + Math.max(0, firstPolygon.length - 1),
    };
  }

  return { ignoredParts: 0 };
}

function shapefileManifestEntry(
  storageKey: string,
  filename: string,
  bytes: Uint8Array,
  checksum: string,
): FileManifestEntry {
  return {
    id: storageKey,
    storageKey,
    path: filename,
    filename: basename(filename),
    extension: "zip",
    kind: "archive",
    size: bytes.byteLength,
    checksum,
    referencedBy: [],
    parseStatus: "unsupported",
    validationStatus: "valid",
    used: true,
    unresolved: false,
    previewHex: hexPreview(bytes),
  };
}

function shapefileStem(filename: string): string | undefined {
  const match = basename(filename).match(/^(.+)\.(shp|dbf|shx|prj|cpg)$/i);
  return match?.[1].toLowerCase();
}

function isShapefileSidecar(filename: string): boolean {
  return /\.(shp|dbf|shx|prj|cpg)$/i.test(basename(filename));
}

async function zipLooseShapefileParts(
  files: ShapefileImportFile[],
): Promise<{ filename: string; bytes: Uint8Array } | undefined> {
  const grouped = new Map<string, ShapefileImportFile[]>();
  for (const file of files) {
    if (!isShapefileSidecar(file.name)) continue;
    const stem = shapefileStem(file.name);
    if (!stem) continue;
    const bucket = grouped.get(stem) ?? [];
    bucket.push(file);
    grouped.set(stem, bucket);
  }

  if (grouped.size !== 1) return undefined;
  const [stem, components] = [...grouped.entries()][0];
  const names = new Set(
    components.map((file) => basename(file.name).toLowerCase()),
  );
  if (
    !names.has(`${stem}.shp`) ||
    !names.has(`${stem}.dbf`) ||
    !names.has(`${stem}.shx`)
  ) {
    return undefined;
  }

  const zip = new JSZip();
  for (const file of components) {
    zip.file(basename(file.name), sourceArrayBuffer(file.bytes));
  }

  return {
    filename: `${stem}.zip`,
    bytes: new Uint8Array(
      await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      }),
    ),
  };
}

export async function importShapefileOverlay(
  dataset: IsoXmlDataset | undefined,
  filename: string,
  bytes: Uint8Array,
  taskId?: string,
): Promise<IsoXmlDataset | undefined> {
  if (!filename.toLowerCase().endsWith(".zip")) return undefined;

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(sourceArrayBuffer(bytes), {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    return undefined;
  }

  const archiveEntries = Object.values(archive.files).filter(
    (entry) => !entry.dir,
  );
  if (
    !archiveEntries.some((entry) => entry.name.toLowerCase().endsWith(".shp"))
  ) {
    return undefined;
  }

  if (!dataset) {
    throw new Error(
      "Open an ISOXML dataset before importing a shapefile ZIP. Standalone shapefile datasets are not supported.",
    );
  }

  const { default: shp } = await import("shpjs");
  const parsed = (await shp(sourceArrayBuffer(bytes))) as
    ParsedShapefileCollection | ParsedShapefileCollection[];
  const collections = Array.isArray(parsed) ? parsed : [parsed];
  const overlayKey = `shape:${crypto.randomUUID()}:${basename(filename)}`;
  const fallbackName =
    basename(filename).replace(/\.zip$/i, "") || "Imported boundary";

  let selectedBoundary: SpatialBoundary | undefined;
  let ignoredPolygonFeatures = 0;
  let ignoredGeometryParts = 0;
  let unsupportedFeatures = 0;

  collections.forEach((collection, collectionIndex) => {
    collection.features.forEach((feature, featureIndex) => {
      const candidate = boundaryFromFeature(
        feature,
        namedProperty(feature.properties) ??
          collection.fileName ??
          fallbackName,
        taskId,
        `${overlayKey}:${collectionIndex}`,
        featureIndex,
      );
      if (candidate.boundary) {
        if (!selectedBoundary) {
          selectedBoundary = candidate.boundary;
          ignoredGeometryParts += candidate.ignoredParts;
        } else {
          ignoredPolygonFeatures += 1;
          ignoredGeometryParts += candidate.ignoredParts;
        }
        return;
      }
      if (feature.geometry) unsupportedFeatures += 1;
    });
  });

  if (!selectedBoundary) {
    throw new Error(
      "The shapefile ZIP did not contain a polygon geometry that can be used as a boundary overlay.",
    );
  }

  const checksum = await sha256(bytes);
  const nextIssues = [
    ...dataset.issues,
    issue({
      severity: "info",
      category: "spatial",
      code: "SHAPEFILE_OVERLAY_IMPORTED",
      message: `Imported shapefile boundary overlay ${selectedBoundary.name}`,
      explanation:
        "The first polygon geometry from the shapefile ZIP is now attached to the active ISOXML dataset as a boundary overlay.",
      filename,
      objectId: selectedBoundary.id,
      suggestedAction:
        "Use the map boundary and clipping tools to compare the overlay with the active spatial layer.",
    }),
  ];

  if (ignoredPolygonFeatures || ignoredGeometryParts || unsupportedFeatures) {
    nextIssues.push(
      issue({
        severity: "warning",
        category: "spatial",
        code: "SHAPEFILE_OVERLAY_PARTIAL",
        message: `${basename(filename)} was imported partially`,
        explanation: [
          ignoredPolygonFeatures
            ? `${ignoredPolygonFeatures} additional polygon features were ignored.`
            : undefined,
          ignoredGeometryParts
            ? `${ignoredGeometryParts} extra polygon parts or holes were ignored.`
            : undefined,
          unsupportedFeatures
            ? `${unsupportedFeatures} non-polygon features were ignored.`
            : undefined,
        ]
          .filter(Boolean)
          .join(" "),
        filename,
        objectId: selectedBoundary.id,
        suggestedAction:
          "Export or simplify one polygon boundary per ZIP when you want a fully lossless round-trip.",
      }),
    );
  }

  return {
    ...dataset,
    boundaries: [selectedBoundary, ...dataset.boundaries],
    files: [
      shapefileManifestEntry(overlayKey, filename, bytes, checksum),
      ...dataset.files,
    ],
    issues: nextIssues,
    rawBytesByFile: {
      ...dataset.rawBytesByFile,
      [overlayKey]: bytes,
    },
    memoryBytes: dataset.memoryBytes + bytes.byteLength,
  };
}

export async function importShapefileOverlayFiles(
  dataset: IsoXmlDataset | undefined,
  files: ShapefileImportFile[],
  taskId?: string,
): Promise<IsoXmlDataset | undefined> {
  if (!files.length) return undefined;

  if (files.length === 1) {
    return importShapefileOverlay(
      dataset,
      files[0].name,
      files[0].bytes,
      taskId,
    );
  }

  const zipped = await zipLooseShapefileParts(files);
  if (!zipped) return undefined;
  return importShapefileOverlay(dataset, zipped.filename, zipped.bytes, taskId);
}
