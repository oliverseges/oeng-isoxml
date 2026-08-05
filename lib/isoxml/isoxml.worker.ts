/// <reference lib="webworker" />

import { workerRequestSchema } from "./object-model";
import { buildDataset } from "./pipeline";
import type { WorkerRequest, WorkerResponse } from "./types";
import { datasetTransferables } from "./worker-transfer";

const workerScope: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const parsed = workerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    const response: WorkerResponse = {
      type: "error",
      requestId: event.data?.requestId ?? "unknown",
      message: "The import request was invalid.",
    };
    workerScope.postMessage(response);
    return;
  }

  const { requestId, files, sourceLabel } = parsed.data;
  try {
    const dataset = await buildDataset(
      files,
      sourceLabel,
      (stage, progress, detail) => {
        const response: WorkerResponse = {
          type: "progress",
          requestId,
          stage,
          progress,
          detail,
        };
        workerScope.postMessage(response);
      },
    );
    const response: WorkerResponse = { type: "complete", requestId, dataset };
    workerScope.postMessage(response, datasetTransferables(dataset));
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "Import failed.",
    };
    workerScope.postMessage(response);
  }
};
