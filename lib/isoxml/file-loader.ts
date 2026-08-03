import JSZip from "jszip";
import { issue } from "./object-model";
import {
  MAX_INPUT_FILE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
} from "./limits";
import type { ValidationIssue, WorkerInputFile } from "./types";

export interface RawPackageFile {
  storageKey: string;
  path: string;
  bytes: Uint8Array;
  fromArchive?: string;
}

function normalizePackagePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
  return normalized;
}

function isZip(path: string): boolean {
  return path.toLowerCase().endsWith(".zip");
}

export async function expandInputFiles(
  inputFiles: WorkerInputFile[],
): Promise<{ files: RawPackageFile[]; issues: ValidationIssue[] }> {
  const files: RawPackageFile[] = [];
  const issues: ValidationIssue[] = [];
  let retainedBytes = 0;

  const retain = (file: Omit<RawPackageFile, "storageKey">) => {
    retainedBytes += file.bytes.byteLength;
    if (retainedBytes > MAX_PACKAGE_BYTES) {
      throw new Error(
        "The selected package exceeds the 512 MiB retained-data limit.",
      );
    }
    if (files.length >= MAX_PACKAGE_FILES) {
      throw new Error(
        `The selected package contains more than ${MAX_PACKAGE_FILES} files.`,
      );
    }
    files.push({
      ...file,
      storageKey: `file:${files.length}:${file.path}`,
    });
  };

  for (const input of inputFiles) {
    const path = normalizePackagePath(input.path);
    if (input.buffer.byteLength > MAX_INPUT_FILE_BYTES) {
      throw new Error(`${path} exceeds the configurable 128 MiB file limit.`);
    }
    const sourceBytes = new Uint8Array(input.buffer);
    retain({ path, bytes: sourceBytes });

    if (!isZip(path)) continue;
    const zip = await JSZip.loadAsync(input.buffer, {
      checkCRC32: true,
      createFolders: false,
    });
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > MAX_PACKAGE_FILES) {
      throw new Error(`${path} contains more than ${MAX_PACKAGE_FILES} files.`);
    }
    for (const entry of entries) {
      const entryPath = normalizePackagePath(entry.name);
      const data = await entry.async("uint8array");
      if (data.byteLength > MAX_INPUT_FILE_BYTES) {
        throw new Error(
          `${entryPath} exceeds the configurable 128 MiB file limit.`,
        );
      }
      retain({ path: entryPath, bytes: data, fromArchive: path });
    }
  }

  const seen = new Map<string, RawPackageFile[]>();
  for (const file of files) {
    const key = file.path.toUpperCase();
    const bucket = seen.get(key) ?? [];
    bucket.push(file);
    seen.set(key, bucket);
  }
  for (const [path, duplicates] of seen) {
    if (duplicates.length > 1) {
      issues.push(
        issue({
          severity: "warning",
          category: "package",
          code: "PACKAGE_DUPLICATE_FILE",
          message: `${path} occurs ${duplicates.length} times`,
          explanation:
            "Every occurrence is listed in the manifest. Typed resolution uses the first exact path match, and package transformation is blocked until duplicates are resolved.",
          filename: duplicates[0].path,
          suggestedAction: "Remove unintended duplicate package entries.",
          recovered: true,
          resultsMayBeIncomplete: false,
        }),
      );
    }
  }

  return { files, issues };
}

export function basename(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

function xmlKind(
  bytes: Uint8Array | undefined,
): "taskdata" | "xml" | undefined {
  if (!bytes?.length) return undefined;
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, Math.min(bytes.length, 512)),
  );
  const normalized = sample.replace(/^\uFEFF/, "").trimStart();
  if (!normalized.startsWith("<")) return undefined;
  return /<ISO11783_TaskData\b/i.test(normalized) ? "taskdata" : "xml";
}

export function classifyFile(
  path: string,
  bytes?: Uint8Array,
):
  | "taskdata"
  | "xml"
  | "grid-binary"
  | "timelog-binary"
  | "archive"
  | "unknown" {
  const name = basename(path);
  const detectedXmlKind = xmlKind(bytes);
  if (detectedXmlKind) return detectedXmlKind;
  if (!bytes && name.toUpperCase() === "TASKDATA.XML") return "taskdata";
  if (!bytes && name.toLowerCase().endsWith(".xml")) return "xml";
  if (/^GRD.*\.BIN$/i.test(name)) return "grid-binary";
  if (/^(TLG|TIM).*\.BIN$/i.test(name)) return "timelog-binary";
  if (name.toLowerCase().endsWith(".zip")) return "archive";
  return "unknown";
}

export function findPackageFile(
  files: RawPackageFile[],
  reference: string,
  declaredLength?: number,
): RawPackageFile | undefined {
  const normalized = reference.replaceAll("\\", "/").toUpperCase();
  const namedMatch =
    files.find((file) => file.path.toUpperCase() === normalized) ??
    files.find(
      (file) =>
        basename(file.path).toUpperCase() === basename(reference).toUpperCase(),
    );
  if (namedMatch) return namedMatch;
  if (Number.isFinite(declaredLength) && declaredLength! > 0) {
    const sizeMatches = files.filter(
      (file) =>
        file.bytes.byteLength === declaredLength &&
        classifyFile(file.path, file.bytes) !== "taskdata" &&
        classifyFile(file.path, file.bytes) !== "xml",
    );
    if (sizeMatches.length === 1) return sizeMatches[0];
  }
  return undefined;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const source =
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hexPreview(bytes: Uint8Array, limit = 32): string {
  return [...bytes.slice(0, limit)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}
