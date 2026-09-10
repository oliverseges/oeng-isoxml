import { basename } from "@/lib/isoxml/file-loader";
import type { ValidationIssue } from "@/lib/isoxml/types";
import type { I18n } from "./i18n";

export interface LocalizedIssueText {
  message: string;
  explanation: string;
  suggestedAction: string;
}

function matchNumber(pattern: RegExp, value: string): number | undefined {
  const match = value.match(pattern);
  return match ? Number(match[1]) : undefined;
}

function matchText(pattern: RegExp, value: string): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}

export function localizeIssue(
  issue: ValidationIssue,
  i18n: I18n,
): LocalizedIssueText {
  switch (issue.code) {
    case "PACKAGE_DUPLICATE_FILE": {
      const count = matchNumber(/occurs (\d+) times/i, issue.message) ?? 0;
      const path =
        issue.filename?.toUpperCase() ?? issue.message.split(" occurs ")[0];
      return {
        message: i18n.t("{path} occurs {count} times", { path, count }),
        explanation: i18n.t(
          "Every occurrence is listed in the manifest. Typed resolution uses the first exact path match, and package transformation is blocked until duplicates are resolved.",
        ),
        suggestedAction: i18n.t("Remove unintended duplicate package entries."),
      };
    }
    case "PACKAGE_MULTIPLE_TASKDATA": {
      const count = matchNumber(/^(\d+) TASKDATA\.XML/i, issue.message) ?? 0;
      return {
        message: i18n.t("{count} TASKDATA.XML files were found", { count }),
        explanation: i18n.t(
          "All are preserved; the first is used as the primary document.",
        ),
        suggestedAction: i18n.t(
          "Import one complete task-data package at a time.",
        ),
      };
    }
    case "PACKAGE_UNCONVENTIONAL_TASKDATA_NAME": {
      const filename = basename(issue.filename ?? "TASKDATA.XML");
      return {
        message: i18n.t(
          "{filename} contains task data but has a nonstandard filename",
          { filename },
        ),
        explanation: i18n.t(
          "The ISO11783_TaskData root element was detected from the file contents.",
        ),
        suggestedAction: i18n.t("Use the conventional TASKDATA.XML filename."),
      };
    }
    case "XML_MALFORMED_OR_UNSAFE":
      return {
        message: i18n.t("{filename} could not be parsed", {
          filename: issue.filename ?? i18n.t("XML source"),
        }),
        explanation: issue.explanation,
        suggestedAction: i18n.t(
          "Repair the XML or remove unsafe declarations.",
        ),
      };
    case "XML_INVALID_ROOT":
      return {
        message: i18n.t("The primary XML root is not ISO11783_TaskData"),
        explanation: i18n.t("The exact raw XML remains available."),
        suggestedAction: i18n.t("Check the root element and package type."),
      };
    case "REF_DUPLICATE_ID":
      return {
        message: i18n.t("ID {id} is declared {count} times", {
          id: issue.objectId ?? "?",
          count: issue.relatedObjects.length,
        }),
        explanation: i18n.t(
          "The viewer preserves every declaration and will not select one silently.",
        ),
        suggestedAction: i18n.t("Correct duplicate IDs in the source system."),
      };
    case "REF_BROKEN":
      return {
        message: i18n.t("{type} references missing object {id}", {
          type: issue.objectType ?? "Object",
          id: issue.relatedObjects[0] ?? issue.objectId ?? "?",
        }),
        explanation: i18n.t(
          "The raw reference is preserved, but the related object cannot be shown.",
        ),
        suggestedAction: i18n.t(
          "Include the referenced object or correct the ID.",
        ),
      };
    case "PDV_MISSING_VALUE_PRESENTATION":
      return {
        message: issue.message,
        explanation: i18n.t(
          "Raw values remain available. A scale or unit is not inferred.",
        ),
        suggestedAction: i18n.t("Supply the referenced VPN/DVP declaration."),
      };
    case "GRID_INVALID_DIMENSIONS": {
      const dims = issue.message.match(/invalid dimensions\s+(-?\d+)\s+×\s+(-?\d+)/i);
      return {
        message: i18n.t("Grid {id} has invalid dimensions {rows} × {columns}", {
          id: issue.objectId ?? "?",
          rows: dims?.[1] ?? "?",
          columns: dims?.[2] ?? "?",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "GRID_CELL_LIMIT_EXCEEDED":
      return {
        message: i18n.t("Grid {id} declares too many cells to decode safely", {
          id: issue.objectId ?? "?",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "GRID_INVALID_COORDINATES":
      return {
        message: i18n.t("Grid {id} has invalid georeferencing", {
          id: issue.objectId ?? "?",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "GRID_TYPE_PARTIAL_SUPPORT": {
      const type = matchNumber(/Grid type\s+(-?\d+)/i, issue.message) ?? 0;
      return {
        message: i18n.t(
          "Grid type {type} is preserved but not decoded by this vertical slice",
          { type },
        ),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "GRID_LAYOUT_AMBIGUOUS":
      return {
        message: i18n.t(
          "Grid {id} does not establish one PDV count per treatment zone",
          { id: issue.objectId ?? "?" },
        ),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "MULTIPLE_PDV_SAME_DDI": {
      const count = matchNumber(/^(\d+) grid channels/i, issue.message) ?? 0;
      const ddi = matchText(/DDI\s+(\d+)/i, issue.message) ?? "0000";
      return {
        message: i18n.t("{count} grid channels share DDI {ddi}", {
          count,
          ddi,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "GRID_BINARY_MISSING":
      return {
        message: i18n.t("Grid binary {filename} is missing", {
          filename: issue.filename ?? "GRID.BIN",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "GRID_BINARY_TRUNCATED":
    case "GRID_BINARY_TRAILING_BYTES": {
      const actual = matchNumber(/has\s+(\d+)\s+bytes/i, issue.message) ?? 0;
      const expected = matchNumber(/;\s+(\d+)\s+expected/i, issue.message) ?? 0;
      return {
        message: i18n.t("{filename} has {actual} bytes; {expected} expected", {
          filename: issue.filename ?? "GRID.BIN",
          actual,
          expected,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "GRID_DECLARED_LENGTH_MISMATCH": {
      const declared = matchNumber(/declares\s+(\d+)\s+bytes/i, issue.message) ?? 0;
      const actual = matchNumber(/contains\s+(\d+)/i, issue.message) ?? 0;
      return {
        message: i18n.t("{filename} declares {declared} bytes but contains {actual}", {
          filename: issue.filename ?? "GRID.BIN",
          declared,
          actual,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "TIMELOG_HEADER_MISSING":
      return {
        message: i18n.t("Time-log header {filename} is missing", {
          filename: issue.filename ?? "TIM.XML",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "TIMELOG_BINARY_MISSING":
      return {
        message: i18n.t("Time-log binary {filename} is missing", {
          filename: issue.filename ?? "TLG.BIN",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "TIMELOG_TYPE_UNSUPPORTED": {
      const type = matchNumber(/Time-log type\s+(-?\d+)/i, issue.message) ?? 0;
      return {
        message: i18n.t("Time-log type {type} is preserved but not decoded", {
          type,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "TIMELOG_ADAPTER_OVERRIDE": {
      const type = matchNumber(/Type\s+(\d+)\s+layout/i, issue.message) ?? 0;
      return {
        message: i18n.t("{filename} is being interpreted with a Type {type} layout", {
          filename: issue.filename ?? "TLG.BIN",
          type,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "TIMELOG_DLV_INDEX_INVALID": {
      const record = matchNumber(/Record\s+(\d+)/i, issue.message) ?? 0;
      const dlvIndex = matchNumber(/DLV index\s+(\d+)/i, issue.message) ?? 0;
      const count = matchNumber(/only\s+(\d+)\s+declarations/i, issue.message) ?? 0;
      return {
        message: i18n.t(
          "Record {index} references DLV index {dlvIndex}, but only {count} declarations exist",
          { index: record, dlvIndex, count },
        ),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "TIMELOG_BINARY_TRUNCATED": {
      const record = matchNumber(/record\s+(\d+)/i, issue.message) ?? 0;
      return {
        message: i18n.t("{filename} ends inside record {index}", {
          filename: issue.filename ?? "TLG.BIN",
          index: record,
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "TIMELOG_RECORD_LIMIT_EXCEEDED":
      return {
        message: i18n.t("{filename} exceeds the safe decoded-record limit", {
          filename: issue.filename ?? "TLG.BIN",
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    case "SHAPEFILE_OVERLAY_IMPORTED": {
      const name = matchText(/overlay\s+(.+)$/i, issue.message) ?? issue.objectId ?? "Boundary";
      return {
        message: i18n.t("Imported shapefile boundary overlay {name}", { name }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    }
    case "SHAPEFILE_OVERLAY_PARTIAL":
      return {
        message: i18n.t("{filename} was imported partially", {
          filename: basename(issue.filename ?? "shape.zip"),
        }),
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
    default:
      return {
        message: issue.message,
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
  }
}

export function localizeRuntimeError(message: string, i18n: I18n): string {
  if (message === "No TASKDATA.XML file was found in the selected package.") {
    return i18n.t("No TASKDATA.XML file was found in the selected package.");
  }

  const maxFiles = matchNumber(/^Choose at most (\d+) files at a time\./i, message);
  if (maxFiles !== undefined) {
    return i18n.t("Choose at most {count} files at a time.", { count: maxFiles });
  }

  const fileLimit = message.match(/^(.*) exceeds the 128 MiB file limit\.$/i);
  if (fileLimit) {
    return i18n.t("{filename} exceeds the 128 MiB file limit.", {
      filename: fileLimit[1],
    });
  }

  const configurableLimit = message.match(/^(.*) exceeds the configurable 128 MiB file limit\.$/i);
  if (configurableLimit) {
    return i18n.t("{filename} exceeds the configurable 128 MiB file limit.", {
      filename: configurableLimit[1],
    });
  }

  if (message === "The selected files exceed the 512 MiB package limit.") {
    return i18n.t("The selected files exceed the 512 MiB package limit.");
  }
  if (message === "The selected package exceeds the 512 MiB retained-data limit.") {
    return i18n.t("The selected package exceeds the 512 MiB retained-data limit.");
  }

  const selectedPackageCount = matchNumber(/^The selected package contains more than (\d+) files\.$/i, message);
  if (selectedPackageCount !== undefined) {
    return i18n.t("The selected package contains more than {count} files.", {
      count: selectedPackageCount,
    });
  }

  const archiveCount = message.match(/^(.*) contains more than (\d+) files\.$/i);
  if (archiveCount) {
    return i18n.t("{filename} contains more than {count} files.", {
      filename: archiveCount[1],
      count: Number(archiveCount[2]),
    });
  }

  const unsafePath = message.match(/^Unsafe archive path: (.*)$/i);
  if (unsafePath) {
    return i18n.t("Unsafe archive path: {path}", { path: unsafePath[1] });
  }

  if (message === "Open an ISOXML dataset before importing a shapefile ZIP. Standalone shapefile datasets are not supported.") {
    return i18n.t("Open an ISOXML dataset before importing a shapefile ZIP. Standalone shapefile datasets are not supported.");
  }
  if (message === "The shapefile ZIP did not contain a polygon geometry that can be used as a boundary overlay.") {
    return i18n.t("The shapefile ZIP did not contain a polygon geometry that can be used as a boundary overlay.");
  }

  return message;
}
