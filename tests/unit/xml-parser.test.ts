import { describe, expect, it } from "vitest";
import { refreshDatasetReferenceMetadata } from "@/lib/isoxml/dataset-upgrades";
import { flattenObjects } from "@/lib/isoxml/object-model";
import { buildRegistry } from "@/lib/isoxml/reference-resolver";
import type { IsoXmlDataset } from "@/lib/isoxml/types";
import { parseLosslessXml } from "@/lib/isoxml/xml-parser";

describe("lossless XML parser", () => {
  it("preserves unknown elements, attributes and child order", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><TSK A="TSK1"><OEM Mystery="yes"/><TZN A="1"><PDV A="0001"/><PDV A="0002"/></TZN></TSK></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const objects = flattenObjects(roots);

    expect(objects.map((object) => object.elementType)).toEqual([
      "ISO11783_TASKDATA",
      "TSK",
      "OEM",
      "TZN",
      "PDV",
      "PDV",
    ]);
    expect(
      objects.find((object) => object.elementType === "OEM")?.attributes,
    ).toEqual({
      Mystery: "yes",
    });
    expect(objects.find((object) => object.elementType === "TSK")?.id).toBe(
      "TSK1",
    );
  });

  it("rejects DTD and entity declarations", () => {
    expect(() =>
      parseLosslessXml(
        `<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x>&secret;</x>`,
        "TASKDATA.XML",
      ),
    ).toThrow(/not allowed/i);
  });

  it("rejects XML that is not well formed before building the object index", () => {
    expect(() =>
      parseLosslessXml(`<ROOT><CHILD></ROOT>`, "BROKEN.XML"),
    ).toThrow(/malformed xml/i);
  });

  it("uses same-element sibling indexes in source paths", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData><TSK A="TSK1"><TZN A="1"/><GRD G="GRD1"/><TZN A="2"/></TSK></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const children = flattenObjects(roots).filter((object) =>
      ["TZN", "GRD"].includes(object.elementType),
    );

    expect(children.map((object) => object.path)).toEqual([
      "/ISO11783_TaskData[1]/TSK[1]/TZN[1]",
      "/ISO11783_TaskData[1]/TSK[1]/GRD[1]",
      "/ISO11783_TaskData[1]/TSK[1]/TZN[2]",
    ]);
  });

  it("gives separate IDs to multiple broken references on one object", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData><TSK A="TSK1" C="CTR404" D="FRM404"/></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const broken = buildRegistry(roots).issues.filter(
      (entry) => entry.code === "REF_BROKEN",
    );

    expect(broken).toHaveLength(2);
    expect(new Set(broken.map((entry) => entry.id)).size).toBe(2);
  });

  it("does not treat the PLN polygon type as a duplicate object ID", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><PFD A="PFD1"><PLN A="1"/></PFD><PFD A="PFD2"><PLN A="1" E="PLN2"/></PFD></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const polygons = flattenObjects(roots).filter(
      (object) => object.elementType === "PLN",
    );
    const { issues } = buildRegistry(roots);

    expect(polygons.map((polygon) => polygon.id)).toEqual([undefined, "PLN2"]);
    expect(issues.some((issue) => issue.code === "REF_DUPLICATE_ID")).toBe(
      false,
    );
  });

  it("removes stale polygon duplicate warnings from restored datasets", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><PFD A="PFD1"><PLN A="1"/></PFD><PFD A="PFD2"><PLN A="1"/></PFD></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const staleObjects = structuredClone(roots);
    flattenObjects(staleObjects)
      .filter((object) => object.elementType === "PLN")
      .forEach((polygon) => {
        polygon.id = "1";
      });
    const staleDataset = {
      objects: staleObjects,
      issues: [
        {
          id: "stale-duplicate",
          severity: "error",
          category: "reference",
          code: "REF_DUPLICATE_ID",
          message: "ID 1 is declared twice",
          explanation: "Stale parser result",
          relatedObjects: [],
          suggestedAction: "Correct duplicate IDs",
          recovered: false,
          resultsMayBeIncomplete: true,
        },
      ],
    } as unknown as IsoXmlDataset;

    const refreshed = refreshDatasetReferenceMetadata(staleDataset);

    expect(
      refreshed.objects
        .filter((object) => object.elementType === "PLN")
        .map((polygon) => polygon.id),
    ).toEqual([undefined, undefined]);
    expect(
      refreshed.issues.some((issue) => issue.code === "REF_DUPLICATE_ID"),
    ).toBe(false);
  });

  it("does not count flattened DVC and DET objects again during refresh", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><DVC A="DVC1"><DET A="DET1"/><DET A="DET2"/></DVC></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const staleDataset = {
      objects: flattenObjects(roots),
      issues: [
        {
          id: "stale-dvc-duplicate",
          severity: "error",
          category: "reference",
          code: "REF_DUPLICATE_ID",
          message: "ID DVC1 is declared 2 times",
          explanation: "Stale metadata refresh result",
          relatedObjects: [],
          suggestedAction: "Correct duplicate IDs",
          recovered: false,
          resultsMayBeIncomplete: true,
        },
      ],
    } as unknown as IsoXmlDataset;

    const refreshed = refreshDatasetReferenceMetadata(staleDataset);

    expect(
      refreshed.objects.map((object) => [object.elementType, object.id]),
    ).toEqual([
      ["ISO11783_TASKDATA", undefined],
      ["DVC", "DVC1"],
      ["DET", "DET1"],
      ["DET", "DET2"],
    ]);
    expect(
      refreshed.issues.some((issue) => issue.code === "REF_DUPLICATE_ID"),
    ).toBe(false);
  });

  it("continues to report IDs that are genuinely declared more than once", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><DVC A="DVC1"/><DVC A="DVC1"/></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const dataset = {
      objects: flattenObjects(roots),
      issues: [],
    } as unknown as IsoXmlDataset;

    const refreshed = refreshDatasetReferenceMetadata(dataset);
    const duplicate = refreshed.issues.find(
      (issue) => issue.code === "REF_DUPLICATE_ID",
    );

    expect(duplicate?.message).toBe("ID DVC1 is declared 2 times");
  });

  it("refreshes issue-derived task, file, and support metadata", () => {
    const roots = parseLosslessXml(
      `<ISO11783_TaskData VersionMajor="4"><TSK A="TSK1"/><TSK A="TSK1"/></ISO11783_TaskData>`,
      "TASKDATA.XML",
    );
    const dataset = {
      objects: flattenObjects(roots),
      issues: [],
      files: [{ path: "TASKDATA.XML", validationStatus: "valid" }],
      tasks: [{ id: "TSK1", gridIds: [], issueCount: 0 }],
      supportSummary: {
        xmlWellFormed: "valid",
        structural: "valid",
        schema: "not-checked",
        references: "valid",
        binary: "valid",
        viewer: "partial",
        roundTrip: "preserved-in-memory",
      },
    } as unknown as IsoXmlDataset;

    const refreshed = refreshDatasetReferenceMetadata(dataset);

    expect(refreshed.files[0].validationStatus).toBe("error");
    expect(refreshed.tasks[0].issueCount).toBe(1);
    expect(refreshed.supportSummary.structural).toBe("invalid");
    expect(refreshed.supportSummary.references).toBe("invalid");
  });
});
