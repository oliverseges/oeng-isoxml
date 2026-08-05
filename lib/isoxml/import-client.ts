import type {
  ImportStage,
  IsoXmlDataset,
  WorkerInputFile,
  WorkerRequest,
  WorkerResponse,
  TimeLogAdapterWorkerRequest,
} from "./types";
import {
  MAX_INPUT_FILE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
} from "./limits";

export interface ImportProgress {
  stage: ImportStage;
  progress: number;
  detail: string;
}

function filePath(file: File): string {
  const candidate = file as File & { webkitRelativePath?: string };
  return candidate.webkitRelativePath || file.name;
}

async function toWorkerFiles(files: File[]): Promise<WorkerInputFile[]> {
  if (files.length > MAX_PACKAGE_FILES) {
    throw new Error(`Choose at most ${MAX_PACKAGE_FILES} files at a time.`);
  }
  let selectedBytes = 0;
  const workerFiles: WorkerInputFile[] = [];
  for (const file of files) {
    if (file.size > MAX_INPUT_FILE_BYTES) {
      throw new Error(`${filePath(file)} exceeds the 128 MiB file limit.`);
    }
    selectedBytes += file.size;
    if (selectedBytes > MAX_PACKAGE_BYTES) {
      throw new Error("The selected files exceed the 512 MiB package limit.");
    }
    workerFiles.push({
      path: filePath(file),
      buffer: await file.arrayBuffer(),
    });
  }
  return workerFiles;
}

export async function importIsoXmlFiles(
  files: File[],
  sourceLabel: string,
  onProgress: (progress: ImportProgress) => void,
): Promise<IsoXmlDataset> {
  if (!files.length) throw new Error("Choose at least one ISOXML file.");
  onProgress({
    stage: "reading",
    progress: 0.02,
    detail: "Reading selected files",
  });
  const workerFiles = await toWorkerFiles(files);
  const worker = new Worker(new URL("./isoxml.worker.ts", import.meta.url), {
    type: "module",
    name: "oeng-isoxml-import",
  });
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "progress") {
        onProgress({
          stage: message.stage,
          progress: message.progress,
          detail: message.detail,
        });
      }
      if (message.type === "complete") {
        worker.terminate();
        resolve(message.dataset);
      }
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(
        new Error(event.message || "The import worker stopped unexpectedly."),
      );
    };
    const request: WorkerRequest = {
      type: "import",
      requestId,
      files: workerFiles,
      sourceLabel,
    };
    worker.postMessage(
      request,
      workerFiles.map((file) => file.buffer),
    );
  });
}

export async function loadSyntheticDemo(
  onProgress: (progress: ImportProgress) => void,
): Promise<IsoXmlDataset> {
  const publicBase = import.meta.env.BASE_URL;
  const [xmlResponse, binaryResponse] = await Promise.all([
    fetch(`${publicBase}demo/TASKDATA.XML`),
    fetch(`${publicBase}demo/GRD00001.BIN`),
  ]);
  if (!xmlResponse.ok || !binaryResponse.ok) {
    throw new Error("The bundled synthetic fixture could not be loaded.");
  }
  const files = [
    new File([await xmlResponse.arrayBuffer()], "TASKDATA.XML", {
      type: "application/xml",
    }),
    new File([await binaryResponse.arrayBuffer()], "GRD00001.BIN", {
      type: "application/octet-stream",
    }),
  ];
  return importIsoXmlFiles(files, "Synthetic three-channel demo", onProgress);
}

export function applyTimeLogAdapter(
  dataset: IsoXmlDataset,
  timeLogInstanceId: string,
  adapterId?: string,
): Promise<IsoXmlDataset> {
  const worker = new Worker(
    new URL("./timelog-adapter.worker.ts", import.meta.url),
    {
      type: "module",
      name: "oeng-isoxml-timelog-adapter",
    },
  );
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "complete") {
        worker.terminate();
        resolve(message.dataset);
      }
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(
        new Error(
          event.message || "The time-log adapter worker stopped unexpectedly.",
        ),
      );
    };
    const request: TimeLogAdapterWorkerRequest = {
      type: "redecode-timelog",
      requestId,
      dataset,
      timeLogInstanceId,
      adapterId,
    };
    worker.postMessage(request);
  });
}
