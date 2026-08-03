import { z } from "zod";
import { MAX_PACKAGE_FILES } from "./limits";
import type { IsoXmlObject, ValidationIssue } from "./types";

export const workerInputFileSchema = z.object({
  path: z.string().min(1).max(1024),
  buffer: z.instanceof(ArrayBuffer),
});

export const workerRequestSchema = z.object({
  type: z.literal("import"),
  requestId: z.string().min(1),
  sourceLabel: z.string().min(1).max(160),
  files: z.array(workerInputFileSchema).min(1).max(MAX_PACKAGE_FILES),
});

const knownIdElements = new Set([
  "AFE",
  "BSN",
  "CCT",
  "CCG",
  "CPC",
  "CTR",
  "DVC",
  "DET",
  "DPD",
  "DPT",
  "DVP",
  "FRM",
  "GGP",
  "GPN",
  "OTQ",
  "PFD",
  "PDT",
  "PGP",
  "PPN",
  "TSK",
  "VPN",
  "WKR",
]);

export function inferObjectId(
  elementType: string,
  attributes: Record<string, string>,
): string | undefined {
  const explicit =
    attributes.id ??
    attributes.ID ??
    attributes.Id ??
    attributes.ObjectId ??
    attributes.ObjectID;
  if (explicit) return explicit;
  const normalizedElementType = elementType.toUpperCase();
  if (normalizedElementType === "PLN") {
    return attributes.E ?? attributes.PolygonId;
  }
  return knownIdElements.has(normalizedElementType) ? attributes.A : undefined;
}

export function flattenObjects(objects: IsoXmlObject[]): IsoXmlObject[] {
  const result: IsoXmlObject[] = [];
  const visit = (object: IsoXmlObject) => {
    result.push(object);
    object.children.forEach(visit);
  };
  objects.forEach(visit);
  return result;
}

export function issue(
  partial: Omit<
    ValidationIssue,
    "id" | "relatedObjects" | "recovered" | "resultsMayBeIncomplete"
  > & {
    relatedObjects?: string[];
    recovered?: boolean;
    resultsMayBeIncomplete?: boolean;
  },
): ValidationIssue {
  return {
    ...partial,
    id: [
      partial.code,
      partial.filename ?? "dataset",
      partial.path ?? partial.objectId ?? crypto.randomUUID(),
      partial.message,
    ].join(":"),
    relatedObjects: partial.relatedObjects ?? [],
    recovered: partial.recovered ?? true,
    resultsMayBeIncomplete: partial.resultsMayBeIncomplete ?? false,
  };
}
