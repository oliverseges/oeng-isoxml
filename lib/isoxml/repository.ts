import { refreshDatasetDdiMetadata } from "./ddi-service";
import { refreshDatasetReferenceMetadata } from "./dataset-upgrades";
import type { IsoXmlDataset } from "./types";

const DATABASE_NAME = "oeng-isoxml-studio";
const DATABASE_VERSION = 1;
const DATASET_STORE = "datasets";
const MAX_PERSISTED_DATASETS = 10;
const MAX_PERSISTED_BYTES = 200 * 1024 * 1024;
const MAX_SINGLE_DATASET_BYTES = 100 * 1024 * 1024;

interface PersistedDataset {
  id: string;
  importedAt: string;
  memoryBytes: number;
  dataset: IsoXmlDataset;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

class DatasetRepository {
  private readonly datasets = new Map<string, IsoXmlDataset>();
  private databasePromise?: Promise<IDBDatabase | undefined>;

  put(dataset: IsoXmlDataset): string {
    const preparedDataset = this.prepare(dataset);
    this.datasets.set(preparedDataset.id, preparedDataset);
    return dataset.id;
  }

  get(id: string | undefined): IsoXmlDataset | undefined {
    return id ? this.datasets.get(id) : undefined;
  }

  remove(id: string): void {
    this.datasets.delete(id);
    void this.removePersisted(id);
  }

  clearStored(ids: string[]): void {
    ids.forEach((id) => this.datasets.delete(id));
    void this.clearPersisted();
  }

  async persist(dataset: IsoXmlDataset): Promise<boolean> {
    const preparedDataset =
      this.datasets.get(dataset.id) ?? this.prepare(dataset);
    if (preparedDataset.memoryBytes > MAX_SINGLE_DATASET_BYTES) return false;
    try {
      const database = await this.openDatabase();
      if (!database) return false;
      const transaction = database.transaction(DATASET_STORE, "readwrite");
      transaction.objectStore(DATASET_STORE).put({
        id: preparedDataset.id,
        importedAt: preparedDataset.importedAt,
        memoryBytes: preparedDataset.memoryBytes,
        dataset: preparedDataset,
      } satisfies PersistedDataset);
      await transactionDone(transaction);
      await this.prunePersisted(database);
      return true;
    } catch (error) {
      console.warn("Recent ISOXML dataset could not be persisted.", error);
      return false;
    }
  }

  async restore(ids: string[]): Promise<IsoXmlDataset[]> {
    if (!ids.length) return [];
    try {
      const database = await this.openDatabase();
      if (!database) return [];
      const transaction = database.transaction(DATASET_STORE, "readonly");
      const completed = transactionDone(transaction);
      const records = await requestResult<PersistedDataset[]>(
        transaction.objectStore(DATASET_STORE).getAll(),
      );
      await completed;
      const byId = new Map(
        records.map((record) => [record.id, record.dataset]),
      );
      return ids.flatMap((id) => {
        const dataset = byId.get(id);
        if (!dataset) return [];
        const refreshedDataset = this.prepare(dataset);
        this.datasets.set(refreshedDataset.id, refreshedDataset);
        return [refreshedDataset];
      });
    } catch (error) {
      console.warn("Recent ISOXML datasets could not be restored.", error);
      return [];
    }
  }

  private prepare(dataset: IsoXmlDataset): IsoXmlDataset {
    return refreshDatasetReferenceMetadata(refreshDatasetDdiMetadata(dataset));
  }

  private openDatabase(): Promise<IDBDatabase | undefined> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === "undefined") {
      this.databasePromise = Promise.resolve(undefined);
      return this.databasePromise;
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DATASET_STORE)) {
          database.createObjectStore(DATASET_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open IndexedDB."));
    });
    return this.databasePromise;
  }

  private async prunePersisted(database: IDBDatabase): Promise<void> {
    const readTransaction = database.transaction(DATASET_STORE, "readonly");
    const readCompleted = transactionDone(readTransaction);
    const records = await requestResult<PersistedDataset[]>(
      readTransaction.objectStore(DATASET_STORE).getAll(),
    );
    await readCompleted;
    records.sort((left, right) =>
      right.importedAt.localeCompare(left.importedAt),
    );
    let retainedBytes = 0;
    const removeIds: string[] = [];
    records.forEach((record, index) => {
      const fits =
        index < MAX_PERSISTED_DATASETS &&
        retainedBytes + record.memoryBytes <= MAX_PERSISTED_BYTES;
      if (fits) retainedBytes += record.memoryBytes;
      else removeIds.push(record.id);
    });
    if (!removeIds.length) return;
    const writeTransaction = database.transaction(DATASET_STORE, "readwrite");
    const store = writeTransaction.objectStore(DATASET_STORE);
    removeIds.forEach((id) => store.delete(id));
    await transactionDone(writeTransaction);
  }

  private async removePersisted(id: string): Promise<void> {
    try {
      const database = await this.openDatabase();
      if (!database) return;
      const transaction = database.transaction(DATASET_STORE, "readwrite");
      transaction.objectStore(DATASET_STORE).delete(id);
      await transactionDone(transaction);
    } catch (error) {
      console.warn("Recent ISOXML dataset could not be removed.", error);
    }
  }

  private async clearPersisted(): Promise<void> {
    try {
      const database = await this.openDatabase();
      if (!database) return;
      const transaction = database.transaction(DATASET_STORE, "readwrite");
      transaction.objectStore(DATASET_STORE).clear();
      await transactionDone(transaction);
    } catch (error) {
      console.warn("Recent ISOXML datasets could not be cleared.", error);
    }
  }
}

export const datasetRepository = new DatasetRepository();
