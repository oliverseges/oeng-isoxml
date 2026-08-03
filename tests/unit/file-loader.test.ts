import { describe, expect, it } from "vitest";
import {
  basename,
  classifyFile,
  expandInputFiles,
  findPackageFile,
} from "@/lib/isoxml/file-loader";
import type { WorkerInputFile } from "@/lib/isoxml/types";

const input = (path: string, bytes: number[] = []): WorkerInputFile => ({
  path,
  buffer: Uint8Array.from(bytes).buffer,
});

describe("package file loading", () => {
  it("rejects traversal and absolute package paths", async () => {
    await expect(expandInputFiles([input("../TASKDATA.XML")])).rejects.toThrow(
      /unsafe archive path/i,
    );
    await expect(expandInputFiles([input("C:\\TASKDATA.XML")])).rejects.toThrow(
      /unsafe archive path/i,
    );
  });

  it("enforces the retained package file-count limit", async () => {
    const files = Array.from({ length: 2_001 }, (_, index) =>
      input(`file-${index}.bin`),
    );

    await expect(expandInputFiles(files)).rejects.toThrow(
      /more than 2000 files/i,
    );
  });

  it("preserves duplicate occurrences and reports their resolution rule", async () => {
    const result = await expandInputFiles([
      input("TASKDATA.XML", [60, 120, 47, 62]),
      input("taskdata.xml", [60, 121, 47, 62]),
    ]);

    expect(result.files).toHaveLength(2);
    expect(new Set(result.files.map((file) => file.storageKey)).size).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "PACKAGE_DUPLICATE_FILE",
      severity: "warning",
      resultsMayBeIncomplete: false,
    });
    expect(result.issues[0].explanation).toContain("first exact path match");
  });

  it("classifies content before extensions and only falls back by unique size", () => {
    const xml = new TextEncoder().encode("<ISO11783_TaskData/>");
    const files = [
      { storageKey: "xml", path: "renamed.data", bytes: xml },
      {
        storageKey: "first",
        path: "first.bin",
        bytes: Uint8Array.of(1, 2),
      },
      {
        storageKey: "second",
        path: "second.bin",
        bytes: Uint8Array.of(3, 4, 5),
      },
    ];

    expect(classifyFile(files[0].path, files[0].bytes)).toBe("taskdata");
    expect(findPackageFile(files, "missing.bin", 3)?.path).toBe("second.bin");
    expect(findPackageFile(files, "missing.bin", 2)?.path).toBe("first.bin");
    expect(basename("nested\\GRD00001.BIN")).toBe("GRD00001.BIN");
  });
});
