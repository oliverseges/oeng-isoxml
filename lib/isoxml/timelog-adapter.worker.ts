/// <reference lib="webworker" />

import { redecodeDatasetTimeLog } from "./timelog-adapters";
import type { TimeLogAdapterWorkerRequest, WorkerResponse } from "./types";
import { datasetTransferables } from "./worker-transfer";

const workerScope: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<TimeLogAdapterWorkerRequest>) => {
  const request = event.data;
  if (
    request?.type !== "redecode-timelog" ||
    !request.requestId ||
    !request.dataset ||
    !request.timeLogInstanceId
  ) {
    const response: WorkerResponse = {
      type: "error",
      requestId: request?.requestId ?? "unknown",
      message: "The time-log adapter request was invalid.",
    };
    workerScope.postMessage(response);
    return;
  }
  try {
    const dataset = redecodeDatasetTimeLog(
      request.dataset,
      request.timeLogInstanceId,
      request.adapterId,
    );
    const response: WorkerResponse = {
      type: "complete",
      requestId: request.requestId,
      dataset,
    };
    workerScope.postMessage(response, datasetTransferables(dataset));
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId: request.requestId,
      message:
        error instanceof Error
          ? error.message
          : "The time-log adapter could not be applied.",
    };
    workerScope.postMessage(response);
  }
};
