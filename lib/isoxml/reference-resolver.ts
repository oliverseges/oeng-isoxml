import { flattenObjects, issue } from "./object-model";
import type { IsoXmlObject, ValidationIssue } from "./types";

export interface ObjectRegistry {
  all: IsoXmlObject[];
  byId: Map<string, IsoXmlObject[]>;
  incoming: Map<string, IsoXmlObject[]>;
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
  DPD: ["F", "DeviceValuePresentationObjectIdRef"],
  DOR: ["A", "DeviceObjectIdRef"],
};

export function buildRegistry(objects: IsoXmlObject[]): {
  registry: ObjectRegistry;
  issues: ValidationIssue[];
} {
  const all = flattenObjects(objects);
  const byId = new Map<string, IsoXmlObject[]>();
  const incoming = new Map<string, IsoXmlObject[]>();
  const issues: ValidationIssue[] = [];

  for (const object of all) {
    if (!object.id) continue;
    const bucket = byId.get(object.id) ?? [];
    bucket.push(object);
    byId.set(object.id, bucket);
  }

  for (const [id, bucket] of byId) {
    if (bucket.length > 1) {
      issues.push(
        issue({
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
        }),
      );
    }
  }

  for (const object of all) {
    const names = referenceAttributes[object.elementType] ?? [];
    const values = new Set(
      names
        .map((name) => object.attributes[name])
        .filter((value): value is string => Boolean(value)),
    );
    for (const value of values) {
      const targets = byId.get(value);
      if (!targets?.length) {
        issues.push(
          issue({
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
          }),
        );
      } else if (targets.length === 1) {
        const bucket = incoming.get(value) ?? [];
        bucket.push(object);
        incoming.set(value, bucket);
      }
    }
  }

  return { registry: { all, byId, incoming }, issues };
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
