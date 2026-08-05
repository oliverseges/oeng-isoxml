import { flattenObjects, issue } from "./object-model";
import type { IsoXmlObject, ValidationIssue } from "./types";

const deviceLocalObjectTypes = new Set(["DPD", "DPT", "DVP"]);

export interface ObjectRegistry {
  all: IsoXmlObject[];
  /** Globally addressable ISOXML IDs. Device-pool object IDs are excluded. */
  byId: Map<string, IsoXmlObject[]>;
  incoming: Map<string, IsoXmlObject[]>;
  deviceObjectsById: Map<string, Map<string, IsoXmlObject[]>>;
  ownerDeviceByObjectUid: Map<string, IsoXmlObject>;
}

const referenceAttributes: Record<string, string[]> = {
  TSK: [
    "C",
    "D",
    "E",
    "F",
    "CustomerIdRef",
    "FarmIdRef",
    "PartfieldIdRef",
    "ResponsibleWorkerIdRef",
  ],
  FRM: ["I", "CustomerIdRef"],
  PFD: ["E", "F", "CustomerIdRef", "FarmIdRef"],
  PDV: [
    "C",
    "D",
    "E",
    "ProductIdRef",
    "DeviceElementIdRef",
    "ValuePresentationIdRef",
  ],
  PAN: [
    "A",
    "E",
    "F",
    "ProductIdRef",
    "DeviceElementIdRef",
    "ValuePresentationIdRef",
  ],
};

const deviceReferenceAttributes: Record<string, string[]> = {
  DOR: ["A", "DeviceObjectIdRef"],
  DPD: ["F", "DeviceValuePresentationObjectIdRef"],
  DPT: ["E", "DeviceValuePresentationObjectIdRef"],
};

function duplicateIssue(id: string, bucket: IsoXmlObject[]): ValidationIssue {
  return issue({
    severity: "error",
    category: "reference",
    code: "REF_DUPLICATE_ID",
    message: `ID ${id} is declared ${bucket.length} times`,
    explanation:
      "The viewer preserves every declaration and will not select one silently.",
    filename: bucket[0].sourceFile,
    objectId: id,
    objectType: bucket[0].elementType,
    path: bucket[0].path,
    relatedObjects: bucket.map((object) => object.uid),
    suggestedAction: "Correct duplicate IDs in the source system.",
    recovered: false,
    resultsMayBeIncomplete: true,
  });
}

function brokenReferenceIssue(
  object: IsoXmlObject,
  value: string,
): ValidationIssue {
  return issue({
    severity: "warning",
    category: "reference",
    code: "REF_BROKEN",
    message: `${object.elementType} references missing object ${value}`,
    explanation:
      "The raw reference is preserved, but the related object cannot be shown.",
    filename: object.sourceFile,
    objectId: object.id,
    objectType: object.elementType,
    path: object.path,
    relatedObjects: [value],
    suggestedAction: "Include the referenced object or correct the ID.",
    recovered: true,
    resultsMayBeIncomplete: true,
  });
}

export function buildRegistry(objects: IsoXmlObject[]): {
  registry: ObjectRegistry;
  issues: ValidationIssue[];
} {
  const all = flattenObjects(objects);
  const byId = new Map<string, IsoXmlObject[]>();
  const incoming = new Map<string, IsoXmlObject[]>();
  const deviceObjectsById = new Map<string, Map<string, IsoXmlObject[]>>();
  const ownerDeviceByObjectUid = new Map<string, IsoXmlObject>();
  const issues: ValidationIssue[] = [];

  const visit = (object: IsoXmlObject, ownerDevice?: IsoXmlObject) => {
    const device = object.elementType === "DVC" ? object : ownerDevice;
    if (device) ownerDeviceByObjectUid.set(object.uid, device);

    if (object.id) {
      if (device && deviceLocalObjectTypes.has(object.elementType)) {
        const deviceBucket = deviceObjectsById.get(device.uid) ?? new Map();
        const bucket = deviceBucket.get(object.id) ?? [];
        bucket.push(object);
        deviceBucket.set(object.id, bucket);
        deviceObjectsById.set(device.uid, deviceBucket);
      } else {
        const bucket = byId.get(object.id) ?? [];
        bucket.push(object);
        byId.set(object.id, bucket);
      }
    }
    object.children.forEach((child) => visit(child, device));
  };
  objects.forEach((object) => visit(object));

  for (const [id, bucket] of byId) {
    if (bucket.length > 1) issues.push(duplicateIssue(id, bucket));
  }
  for (const deviceBucket of deviceObjectsById.values()) {
    for (const [id, bucket] of deviceBucket) {
      if (bucket.length > 1) issues.push(duplicateIssue(id, bucket));
    }
  }

  for (const object of all) {
    const globalNames = referenceAttributes[object.elementType] ?? [];
    const globalValues = new Set(
      globalNames
        .map((name) => object.attributes[name])
        .filter((value): value is string => Boolean(value)),
    );
    for (const value of globalValues) {
      const targets = byId.get(value);
      if (!targets?.length) {
        issues.push(brokenReferenceIssue(object, value));
      } else if (targets.length === 1) {
        const bucket = incoming.get(value) ?? [];
        bucket.push(object);
        incoming.set(value, bucket);
      }
    }

    const deviceNames = deviceReferenceAttributes[object.elementType] ?? [];
    if (!deviceNames.length) continue;
    const ownerDevice = ownerDeviceByObjectUid.get(object.uid);
    const localObjects = ownerDevice
      ? deviceObjectsById.get(ownerDevice.uid)
      : undefined;
    const localValues = new Set(
      deviceNames
        .map((name) => object.attributes[name])
        .filter((value): value is string => Boolean(value)),
    );
    for (const value of localValues) {
      const targets = localObjects?.get(value);
      if (!targets?.length) {
        issues.push(brokenReferenceIssue(object, value));
      } else if (targets.length === 1) {
        const bucket = incoming.get(targets[0].uid) ?? [];
        bucket.push(object);
        incoming.set(targets[0].uid, bucket);
      }
    }
  }

  return {
    registry: {
      all,
      byId,
      incoming,
      deviceObjectsById,
      ownerDeviceByObjectUid,
    },
    issues,
  };
}

export function resolveOne(
  registry: ObjectRegistry,
  id: string | undefined,
  elementTypes?: string[],
): IsoXmlObject | undefined {
  if (!id) return undefined;
  const candidates = registry.byId.get(id) ?? [];
  const filtered = elementTypes?.length
    ? candidates.filter((object) => elementTypes.includes(object.elementType))
    : candidates;
  return filtered.length === 1 ? filtered[0] : undefined;
}

export function resolveDeviceObject(
  registry: ObjectRegistry,
  context: IsoXmlObject | undefined,
  id: string | undefined,
  elementTypes?: string[],
): IsoXmlObject | undefined {
  if (!context || !id) return undefined;
  const ownerDevice =
    context.elementType === "DVC"
      ? context
      : registry.ownerDeviceByObjectUid.get(context.uid);
  if (!ownerDevice) return undefined;
  const candidates =
    registry.deviceObjectsById.get(ownerDevice.uid)?.get(id) ?? [];
  const filtered = elementTypes?.length
    ? candidates.filter((object) => elementTypes.includes(object.elementType))
    : candidates;
  return filtered.length === 1 ? filtered[0] : undefined;
}
