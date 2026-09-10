import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/client/i18n";
import { localizeIssue, localizeRuntimeError } from "@/lib/client/issue-i18n";
import type { ValidationIssue } from "@/lib/isoxml/types";

function issue(partial: Partial<ValidationIssue> & Pick<ValidationIssue, "code" | "message" | "explanation" | "suggestedAction" | "severity" | "category" | "recovered" | "resultsMayBeIncomplete" | "relatedObjects" | "id">): ValidationIssue {
  return {
    filename: undefined,
    objectId: undefined,
    objectType: undefined,
    path: undefined,
    byteOffset: undefined,
    ...partial,
  };
}

describe("issue i18n", () => {
  it("localizes package duplicate messages in German", () => {
    const localized = localizeIssue(
      issue({
        id: "1",
        code: "PACKAGE_DUPLICATE_FILE",
        severity: "warning",
        category: "package",
        message: "TASKDATA.XML occurs 2 times",
        explanation: "Every occurrence is listed in the manifest.",
        suggestedAction: "Remove unintended duplicate package entries.",
        relatedObjects: [],
        recovered: true,
        resultsMayBeIncomplete: false,
        filename: "TASKDATA.XML",
      }),
      createI18n("de"),
    );

    expect(localized.message).toBe("TASKDATA.XML occurs 2 times");
    expect(localized.suggestedAction).toBe(
      "Remove unintended duplicate package entries.",
    );
  });

  it("localizes grid dimension messages in Danish", () => {
    const localized = localizeIssue(
      issue({
        id: "2",
        code: "GRID_INVALID_DIMENSIONS",
        severity: "error",
        category: "grid",
        message: "Grid GRD1 has invalid dimensions 0 × -1",
        explanation: "A positive integer row and column count is required.",
        suggestedAction: "Correct the GRD dimension attributes.",
        relatedObjects: [],
        recovered: false,
        resultsMayBeIncomplete: true,
        objectId: "GRD1",
      }),
      createI18n("da"),
    );

    expect(localized.message).toBe(
      "Gitter GRD1 har ugyldige dimensioner 0 × -1",
    );
    expect(localized.explanation).toBe(
      "A positive integer row and column count is required.",
    );
  });

  it("localizes runtime import errors in Danish", () => {
    expect(
      localizeRuntimeError(
        "No TASKDATA.XML file was found in the selected package.",
        createI18n("da"),
      ),
    ).toBe("Ingen TASKDATA.XML-fil blev fundet i den valgte pakke.");
  });
});