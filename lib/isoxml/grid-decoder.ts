import { describeDdi, parseDdi } from "./ddi-service";
import { MAX_GRID_CELL_COUNT, MAX_PRESENTATION_DECIMALS } from "./limits";
import { issue } from "./object-model";
import type { ObjectRegistry } from "./reference-resolver";
import { resolveOne } from "./reference-resolver";
import type {
  DecodedGrid,
  GridChannel,
  IsoXmlObject,
  ValidationIssue,
  ValuePresentation,
} from "./types";
import { getAttribute } from "./xml-parser";

function numberAttribute(
  object: IsoXmlObject,
  names: string[],
  fallback = Number.NaN,
): number {
  const value = getAttribute(object, names);
  return value === undefined ? fallback : Number(value);
}

function descendantObjects(
  object: IsoXmlObject,
  elementType: string,
): IsoXmlObject[] {
  const target = elementType.toUpperCase();
  const result: IsoXmlObject[] = [];
  const visit = (candidate: IsoXmlObject) => {
    if (candidate.elementType === target) result.push(candidate);
    candidate.children.forEach(visit);
  };
  object.children.forEach(visit);
  return result;
}

function presentationFor(
  pdv: IsoXmlObject,
  registry: ObjectRegistry,
  issues: ValidationIssue[],
): ValuePresentation {
  const presentationId = getAttribute(pdv, [
    "E",
    "ValuePresentationIdRef",
    "ValuePresentationObjectIdRef",
  ]);
  const object = resolveOne(registry, presentationId, ["VPN", "DVP"]);
  if (!object) {
    issues.push(
      issue({
        severity: "warning",
        category: "semantic",
        code: "PDV_MISSING_VALUE_PRESENTATION",
        message: `PDV ${pdv.id ?? pdv.uid} has no resolvable value presentation`,
        explanation:
          "Raw values remain available. A scale or unit is not inferred.",
        filename: pdv.sourceFile,
        objectId: pdv.id,
        objectType: "PDV",
        path: pdv.path,
        suggestedAction: "Supply the referenced VPN/DVP declaration.",
        recovered: true,
        resultsMayBeIncomplete: false,
      }),
    );
    return {
      id: presentationId ?? "missing",
      offset: "0",
      scale: "1",
      decimals: 0,
      source: "No value presentation",
      confidence: "missing",
    };
  }

  const offset = getAttribute(object, ["B", "Offset"]) ?? "0";
  const scale = getAttribute(object, ["C", "Scale"]) ?? "1";
  const decimals = Number(
    getAttribute(object, ["D", "NumberOfDecimals"]) ?? "0",
  );
  const unit = getAttribute(object, ["E", "UnitDesignator"]);
  const valid =
    Number.isFinite(Number(offset)) &&
    Number.isFinite(Number(scale)) &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= MAX_PRESENTATION_DECIMALS;
  if (!valid || Number(scale) === 0) {
    issues.push(
      issue({
        severity: "error",
        category: "semantic",
        code: "VALUE_PRESENTATION_INVALID",
        message: `Value presentation ${object.id ?? object.uid} is invalid`,
        explanation: `Offset and scale must be finite, scale must be non-zero, and decimals must be an integer from 0 to ${MAX_PRESENTATION_DECIMALS}.`,
        filename: object.sourceFile,
        objectId: object.id,
        objectType: object.elementType,
        path: object.path,
        suggestedAction: "Correct the declared scale, offset and decimals.",
        recovered: true,
        resultsMayBeIncomplete: false,
      }),
    );
  }
  return {
    id: object.id ?? object.uid,
    offset,
    scale,
    decimals:
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= MAX_PRESENTATION_DECIMALS
        ? decimals
        : 0,
    unit,
    source: `${object.elementType} ${object.id ?? object.uid}`,
    confidence: valid && Number(scale) !== 0 ? "declared" : "invalid",
  };
}

function channelsForTreatmentZone(
  task: IsoXmlObject,
  registry: ObjectRegistry,
  issues: ValidationIssue[],
): { treatmentZone: IsoXmlObject; channels: GridChannel[] }[] {
  const zones = descendantObjects(task, "TZN");
  return zones.map((zone) => {
    const pdvs = zone.children.filter((child) => child.elementType === "PDV");
    const zoneCode =
      getAttribute(zone, ["A", "TreatmentZoneCode"]) ?? "unknown";
    const channels = pdvs.map((pdv, pdvIndex): GridChannel => {
      const ddi = parseDdi(getAttribute(pdv, ["A", "ProcessDataDDI", "DDI"]));
      const ddiInfo = describeDdi(ddi);
      const productId = getAttribute(pdv, ["C", "ProductIdRef"]);
      const deviceElementId = getAttribute(pdv, ["D", "DeviceElementIdRef"]);
      const productAllocationId = getAttribute(pdv, [
        "F",
        "ProductAllocationIdRef",
      ]);
      const product = resolveOne(registry, productId, ["PDT"]);
      const deviceElement = resolveOne(registry, deviceElementId, ["DET"]);
      const presentation = presentationFor(pdv, registry, issues);
      const ddiDisplay = ddi >= 0 ? String(ddi).padStart(4, "0") : "????";
      const productName = product
        ? getAttribute(product, ["B", "ProductDesignator", "Designator"])
        : undefined;
      const deviceElementName = deviceElement
        ? getAttribute(deviceElement, [
            "D",
            "DeviceElementDesignator",
            "Designator",
          ])
        : undefined;
      return {
        channelId: `${task.id ?? task.uid}:${zoneCode}:${pdvIndex}:${ddiDisplay}:${productId ?? "no-product"}:${deviceElementId ?? "no-det"}`,
        pdvIndex,
        pdvObjectUid: pdv.uid,
        ddi,
        ddiDisplay,
        ddiName: ddiInfo.name,
        dictionarySource: ddiInfo.source,
        productId,
        productName,
        productAllocationId,
        deviceElementId,
        deviceElementName,
        valuePresentationId: presentation.id,
        presentation,
        unit: presentation.unit,
        label: `DDI ${ddiDisplay} · ${ddiInfo.name} · ${productName ?? "Product unresolved"}${deviceElementName ? ` · ${deviceElementName}` : ""}`,
      };
    });
    return { treatmentZone: zone, channels };
  });
}

export function decodeGrid(
  gridObject: IsoXmlObject,
  task: IsoXmlObject,
  registry: ObjectRegistry,
  binary: Uint8Array | undefined,
  identity?: {
    gridInstanceId: string;
    taskInstanceId: string;
    sourceBinaryKey?: string;
  },
): DecodedGrid {
  const issues: ValidationIssue[] = [];
  const usesCompactIsoXmlLayout =
    ["A", "B", "C", "D", "E", "F", "G", "I"].every(
      (attribute) => gridObject.attributes[attribute] !== undefined,
    ) &&
    Number.isFinite(Number(gridObject.attributes.A)) &&
    Number.isFinite(Number(gridObject.attributes.B));
  const rawFilename = usesCompactIsoXmlLayout
    ? gridObject.attributes.G
    : getAttribute(gridObject, ["Filename", "GridFilename", "B"]);
  const filename = rawFilename
    ? /\.[a-z0-9]+$/i.test(rawFilename)
      ? rawFilename
      : `${rawFilename}.BIN`
    : "GRID.BIN";
  const filenameId = filename.replace(/\.[^.]+$/, "");
  const id = gridObject.id ?? filenameId ?? gridObject.uid;
  const gridType = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.I)
    : numberAttribute(gridObject, ["GridType", "C"], -1);
  const rows = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.F)
    : numberAttribute(gridObject, ["GridMaximumRow", "I"], 0);
  const columns = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.E)
    : numberAttribute(gridObject, ["GridMaximumColumn", "H"], 0);
  const originLatitude = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.A)
    : numberAttribute(gridObject, [
        "GridMinimumNorthPosition",
        "OriginLatitude",
        "D",
      ]);
  const originLongitude = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.B)
    : numberAttribute(gridObject, [
        "GridMinimumEastPosition",
        "OriginLongitude",
        "E",
      ]);
  const northSouth = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.C)
    : numberAttribute(gridObject, ["GridCellNorthSouthSize", "F"]);
  const eastWest = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.D)
    : numberAttribute(gridObject, ["GridCellEastWestSize", "G"]);
  const declaredBinaryLength = usesCompactIsoXmlLayout
    ? Number(gridObject.attributes.H)
    : undefined;
  const cellSizeUnit = usesCompactIsoXmlLayout ? "degrees" : "meters";
  const originCorner = usesCompactIsoXmlLayout ? "southwest" : "northwest";
  const spatialStatus =
    Number.isFinite(originLatitude) &&
    Number.isFinite(originLongitude) &&
    Math.abs(originLatitude) <= 90 &&
    Math.abs(originLongitude) <= 180 &&
    Number.isFinite(northSouth) &&
    Number.isFinite(eastWest) &&
    northSouth > 0 &&
    eastWest > 0
      ? "valid"
      : "invalid";
  const zoneChannels = channelsForTreatmentZone(task, registry, issues);
  const channelCounts = new Set(
    zoneChannels.map((entry) => entry.channels.length),
  );
  const dimensionsValid =
    Number.isInteger(rows) &&
    Number.isInteger(columns) &&
    rows > 0 &&
    columns > 0;
  const declaredCellCount = rows * columns;
  const cellCountIsSafe =
    dimensionsValid && Number.isSafeInteger(declaredCellCount);
  const expectedCellCount = cellCountIsSafe ? declaredCellCount : 0;
  const cellCountWithinLimit =
    cellCountIsSafe && expectedCellCount <= MAX_GRID_CELL_COUNT;

  if (!dimensionsValid) {
    issues.push(
      issue({
        severity: "error",
        category: "grid",
        code: "GRID_INVALID_DIMENSIONS",
        message: `Grid ${id} has invalid dimensions ${rows} × ${columns}`,
        explanation: "A positive integer row and column count is required.",
        filename: gridObject.sourceFile,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction: "Correct the GRD dimension attributes.",
        recovered: false,
        resultsMayBeIncomplete: true,
      }),
    );
  } else if (!cellCountIsSafe || !cellCountWithinLimit) {
    issues.push(
      issue({
        severity: "error",
        category: "grid",
        code: "GRID_CELL_LIMIT_EXCEEDED",
        message: `Grid ${id} declares too many cells to decode safely`,
        explanation: `${rows} × ${columns} exceeds the ${MAX_GRID_CELL_COUNT.toLocaleString()}-cell viewer limit or cannot be represented safely. Raw XML and binary bytes remain available.`,
        filename: gridObject.sourceFile,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction:
          "Split the grid or reduce its declared dimensions before viewing it.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  if (spatialStatus === "invalid") {
    issues.push(
      issue({
        severity: "error",
        category: "spatial",
        code: "GRID_INVALID_COORDINATES",
        message: `Grid ${id} has invalid georeferencing`,
        explanation: `Origin (${originLatitude}, ${originLongitude}), cell size (${northSouth}, ${eastWest}) could not be converted into finite geographic bounds.`,
        filename: gridObject.sourceFile,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction:
          "Check the GRD A–F attributes and coordinate convention.",
        recovered: true,
        resultsMayBeIncomplete: false,
      }),
    );
  }

  if (gridType !== 2) {
    issues.push(
      issue({
        severity: "warning",
        category: "support",
        code: "GRID_TYPE_PARTIAL_SUPPORT",
        message: `Grid type ${gridType} is preserved but not decoded by this vertical slice`,
        explanation:
          "Only direct-value Type 2 cells are decoded. The raw object and bytes remain available.",
        filename: gridObject.sourceFile,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction:
          "Inspect raw data or install a verified decoder adapter.",
        recovered: true,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  if (channelCounts.size !== 1 || zoneChannels.length === 0) {
    issues.push(
      issue({
        severity: "error",
        category: "grid",
        code: "GRID_LAYOUT_AMBIGUOUS",
        message: `Grid ${id} does not establish one PDV count per treatment zone`,
        explanation: `Observed PDV counts: ${[...channelCounts].join(", ") || "none"}. The viewer will not guess a binary record width.`,
        filename: gridObject.sourceFile,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction: "Check TZN/PDV declarations and the binary layout.",
        recovered: false,
        resultsMayBeIncomplete: true,
      }),
    );
  }

  const channels = zoneChannels[0]?.channels ?? [];
  const repeatedDdis = new Map<number, GridChannel[]>();
  for (const channel of channels) {
    const bucket = repeatedDdis.get(channel.ddi) ?? [];
    bucket.push(channel);
    repeatedDdis.set(channel.ddi, bucket);
  }
  for (const [ddi, bucket] of repeatedDdis) {
    if (bucket.length > 1) {
      issues.push(
        issue({
          severity: "info",
          category: "semantic",
          code: "MULTIPLE_PDV_SAME_DDI",
          message: `${bucket.length} grid channels share DDI ${String(ddi).padStart(4, "0")}`,
          explanation:
            "Channels remain independent because product, PDV order and device evidence differ.",
          filename: gridObject.sourceFile,
          objectId: id,
          objectType: "GRD",
          path: gridObject.path,
          relatedObjects: bucket.map((channel) => channel.pdvObjectUid),
          suggestedAction:
            "Select channels by their full identity, not by DDI alone.",
          recovered: true,
          resultsMayBeIncomplete: false,
        }),
      );
    }
  }

  const bytesPerCell = gridType === 2 ? channels.length * 4 : 0;
  const expectedLengthProduct = expectedCellCount * bytesPerCell;
  const expectedLength =
    cellCountWithinLimit && Number.isSafeInteger(expectedLengthProduct)
      ? expectedLengthProduct
      : 0;
  const actualLength = binary?.byteLength ?? 0;
  if (!binary) {
    issues.push(
      issue({
        severity: "error",
        category: "grid",
        code: "GRID_BINARY_MISSING",
        message: `Grid binary ${filename} is missing`,
        explanation:
          "The GRD object is available, but cell values cannot be decoded.",
        filename,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction: "Import the referenced binary file.",
        recovered: false,
        resultsMayBeIncomplete: true,
      }),
    );
  } else if (
    cellCountWithinLimit &&
    bytesPerCell > 0 &&
    actualLength !== expectedLength
  ) {
    issues.push(
      issue({
        severity: actualLength < expectedLength ? "error" : "warning",
        category: "grid",
        code:
          actualLength < expectedLength
            ? "GRID_BINARY_TRUNCATED"
            : "GRID_BINARY_TRAILING_BYTES",
        message: `${filename} has ${actualLength} bytes; ${expectedLength} expected`,
        explanation: `${bytesPerCell} bytes/cell × ${expectedCellCount} cells based on ${channels.length} ordered signed Int32 little-endian PDVs.`,
        filename,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        byteOffset: Math.min(actualLength, expectedLength),
        suggestedAction:
          "Compare the declared dimensions, PDV order and binary export.",
        recovered: actualLength >= bytesPerCell,
        resultsMayBeIncomplete: actualLength < expectedLength,
      }),
    );
  }
  if (
    binary &&
    typeof declaredBinaryLength === "number" &&
    Number.isFinite(declaredBinaryLength) &&
    declaredBinaryLength !== binary.byteLength
  ) {
    issues.push(
      issue({
        severity: "warning",
        category: "grid",
        code: "GRID_DECLARED_LENGTH_MISMATCH",
        message: `${filename} declares ${declaredBinaryLength} bytes but contains ${binary.byteLength}`,
        explanation:
          "GRD attribute H does not match the imported binary length.",
        filename,
        objectId: id,
        objectType: "GRD",
        path: gridObject.path,
        suggestedAction:
          "Verify that the XML and BIN files belong to the same export.",
        recovered: true,
        resultsMayBeIncomplete: binary.byteLength < declaredBinaryLength,
      }),
    );
  }

  const decodedCellCount =
    binary && cellCountWithinLimit && bytesPerCell > 0
      ? Math.min(
          expectedCellCount,
          Math.floor(binary.byteLength / bytesPerCell),
        )
      : 0;
  const treatmentZoneCodes = new Uint16Array(decodedCellCount);
  const rawValues = channels.map(() => {
    return new Int32Array(decodedCellCount);
  });

  if (binary && gridType === 2 && channelCounts.size === 1) {
    const view = new DataView(
      binary.buffer,
      binary.byteOffset,
      binary.byteLength,
    );
    for (let cellIndex = 0; cellIndex < decodedCellCount; cellIndex += 1) {
      const base = cellIndex * bytesPerCell;
      for (
        let channelIndex = 0;
        channelIndex < channels.length;
        channelIndex += 1
      ) {
        rawValues[channelIndex][cellIndex] = view.getInt32(
          base + channelIndex * 4,
          true,
        );
      }
    }
  }

  return {
    instanceId: identity?.gridInstanceId ?? gridObject.uid,
    id,
    sourceObjectUid: gridObject.uid,
    taskInstanceId: identity?.taskInstanceId ?? task.uid,
    taskId: task.id ?? task.uid,
    name: getAttribute(gridObject, ["GridDesignator", "Designator"]) ?? id,
    filename,
    sourceBinaryKey: identity?.sourceBinaryKey,
    gridType,
    rows,
    columns,
    origin: { latitude: originLatitude, longitude: originLongitude },
    cellSize: { northSouth, eastWest },
    cellSizeUnit,
    originCorner,
    spatialStatus,
    channels,
    treatmentZoneCodes,
    rawValues,
    decodedCellCount,
    expectedCellCount,
    bytesPerCell,
    binaryLength: actualLength,
    declaredBinaryLength: Number.isFinite(declaredBinaryLength)
      ? declaredBinaryLength
      : undefined,
    validationIssues: issues,
  };
}
