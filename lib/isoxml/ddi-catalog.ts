import dictionaryData from "./data/isobus-ddi.json";
import { describeDdi, type DdiSummary } from "./ddi-service";

export interface IsobusUnit {
  id: number;
  name: string;
  symbol: string;
}

export interface IsobusDeviceClass {
  id: number;
  name: string;
}

export interface DdiDefinition extends DdiSummary {
  description: string;
  comment?: string;
  sourceVersion?: string;
  unitSymbol?: string;
  bitResolution?: string;
  canBusRange?: string;
  displayRange?: string;
  deviceClasses: IsobusDeviceClass[];
  status?: string;
  revision?: string;
}

type DdiCatalogEntry = readonly [
  ddi: number,
  recordId: number,
  name: string,
  definition: string | null,
  comment: string | null,
  deviceClasses: number[],
  unitSymbol: string | null,
  bitResolution: string | null,
  canBusRange: string | null,
  displayRange: string | null,
  status: string | null,
  revision: string | null,
];

export const ISOBUS_UNITS = dictionaryData.units as readonly IsobusUnit[];
export const ISOBUS_DEVICE_CLASSES =
  dictionaryData.deviceClasses as readonly IsobusDeviceClass[];

const deviceClassById = new Map(
  ISOBUS_DEVICE_CLASSES.map((deviceClass) => [deviceClass.id, deviceClass]),
);

const bundledDictionary = new Map<number, DdiDefinition>(
  (dictionaryData.entries as unknown as DdiCatalogEntry[]).map(
    ([
      ddi,
      ,
      ,
      definition,
      comment,
      deviceClasses,
      unitSymbol,
      bitResolution,
      canBusRange,
      displayRange,
      status,
      revision,
    ]) => {
      const summary = describeDdi(ddi);
      return [
        ddi,
        {
          ...summary,
          description: definition ?? "The official entry has no definition.",
          comment: comment ?? undefined,
          sourceVersion: dictionaryData.version,
          unitSymbol: unitSymbol ?? undefined,
          bitResolution: bitResolution ?? undefined,
          canBusRange: canBusRange ?? undefined,
          displayRange: displayRange ?? undefined,
          deviceClasses: deviceClasses.map(
            (deviceClass) =>
              deviceClassById.get(deviceClass) ?? {
                id: deviceClass,
                name: `Device class ${deviceClass}`,
              },
          ),
          status: status ?? undefined,
          revision: revision ?? undefined,
        },
      ];
    },
  ),
);

export function describeDdiDetails(ddi: number): DdiDefinition {
  return (
    bundledDictionary.get(ddi) ?? {
      ...describeDdi(ddi),
      description:
        "No official dictionary entry matches this identifier. The raw identifier remains usable.",
      deviceClasses: [],
    }
  );
}
