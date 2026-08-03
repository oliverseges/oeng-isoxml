import { XMLParser, XMLValidator } from "fast-xml-parser";
import { inferObjectId } from "./object-model";
import { MAX_XML_CHARACTERS } from "./limits";
import type { IsoXmlObject } from "./types";

type OrderedXmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  htmlEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: false,
});

export function assertSafeXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("DTD and entity declarations are not allowed.");
  }
  if (xml.length > MAX_XML_CHARACTERS) {
    throw new Error("XML file exceeds the 64 MiB safe parsing limit.");
  }
}

export function parseLosslessXml(
  xml: string,
  sourceFile: string,
  sourceFileKey = sourceFile,
): IsoXmlObject[] {
  assertSafeXml(xml);
  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  });
  if (validation !== true) {
    const location = validation.err.line
      ? ` at line ${validation.err.line}, column ${validation.err.col}`
      : "";
    throw new Error(`Malformed XML${location}: ${validation.err.msg}`);
  }
  const ordered = parser.parse(xml) as OrderedXmlNode[];
  let uidCounter = 0;

  const elementName = (node: OrderedXmlNode) =>
    Object.keys(node).find(
      (key) => key !== ":@" && key !== "#text" && key !== "?xml",
    );

  const convert = (
    node: OrderedXmlNode,
    parentPath: string,
    siblingIndex: number,
  ): IsoXmlObject | undefined => {
    const elementType = elementName(node);
    if (!elementType) return undefined;

    const rawAttributes = node[":@"];
    const attributes =
      rawAttributes && typeof rawAttributes === "object"
        ? Object.fromEntries(
            Object.entries(rawAttributes as Record<string, unknown>).map(
              ([key, value]) => [key, String(value)],
            ),
          )
        : {};
    const path = `${parentPath}/${elementType}[${siblingIndex + 1}]`;
    const rawChildren = Array.isArray(node[elementType])
      ? (node[elementType] as OrderedXmlNode[])
      : [];
    const children: IsoXmlObject[] = [];
    const siblingCounts = new Map<string, number>();
    let text: string | undefined;

    for (const child of rawChildren) {
      if ("#text" in child) {
        const value = child["#text"];
        if (typeof value === "string" && value.trim()) text = value;
        continue;
      }
      const childElementType = elementName(child);
      if (!childElementType) continue;
      const childElementIndex = siblingCounts.get(childElementType) ?? 0;
      const converted = convert(child, path, childElementIndex);
      if (converted) {
        children.push(converted);
        siblingCounts.set(childElementType, childElementIndex + 1);
      }
    }

    uidCounter += 1;
    return {
      uid: `${sourceFileKey}:${uidCounter}`,
      id: inferObjectId(elementType.toUpperCase(), attributes),
      elementType: elementType.toUpperCase(),
      attributes,
      children,
      sourceFile,
      sourceFileKey,
      path,
      text,
    };
  };

  const rootCounts = new Map<string, number>();
  return ordered.flatMap((node) => {
    const rootElementType = elementName(node);
    if (!rootElementType) return [];
    const rootIndex = rootCounts.get(rootElementType) ?? 0;
    rootCounts.set(rootElementType, rootIndex + 1);
    const object = convert(node, "", rootIndex);
    return object ? [object] : [];
  });
}

export function findObjects(
  objects: IsoXmlObject[],
  elementType: string,
): IsoXmlObject[] {
  const target = elementType.toUpperCase();
  const result: IsoXmlObject[] = [];
  const visit = (object: IsoXmlObject) => {
    if (object.elementType === target) result.push(object);
    object.children.forEach(visit);
  };
  objects.forEach(visit);
  return result;
}

export function getAttribute(
  object: IsoXmlObject,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = object.attributes[name];
    if (value !== undefined) return value;
  }
  return undefined;
}
