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

export function localizeIssue(
  issue: ValidationIssue,
  i18n: I18n,
): LocalizedIssueText {
  switch (issue.code) {
    case "PACKAGE_DUPLICATE_FILE": {
      const count = matchNumber(/occurs (\d+) times/i, issue.message) ?? 0;
      const path = issue.filename?.toUpperCase() ?? issue.message.split(" occurs ")[0];
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
        explanation: i18n.t("All are preserved; the first is used as the primary document."),
        suggestedAction: i18n.t("Import one complete task-data package at a time."),
      };
    }
    case "PACKAGE_UNCONVENTIONAL_TASKDATA_NAME": {
      const filename = basename(issue.filename ?? "TASKDATA.XML");
      return {
        message: i18n.t("{filename} contains task data but has a nonstandard filename", { filename }),
        explanation: i18n.t("The ISO11783_TaskData root element was detected from the file contents."),
        suggestedAction: i18n.t("Use the conventional TASKDATA.XML filename."),
      };
    }
    case "XML_MALFORMED_OR_UNSAFE":
      return {
        message: i18n.t("{filename} could not be parsed", {
          filename: issue.filename ?? i18n.t("XML source"),
        }),
        explanation: issue.explanation,
        suggestedAction: i18n.t("Repair the XML or remove unsafe declarations."),
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
        suggestedAction: i18n.t("Include the referenced object or correct the ID."),
      };
    default:
      return {
        message: issue.message,
        explanation: issue.explanation,
        suggestedAction: issue.suggestedAction,
      };
  }
}