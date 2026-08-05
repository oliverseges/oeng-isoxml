import type { TimeLogChannel } from "./types";

export type OperationGroupId =
  | "seeding"
  | "liming"
  | "fertilizing"
  | "plant-protection"
  | "harvesting"
  | "soil-work"
  | "other";

export interface OperationGroupDefinition {
  id: OperationGroupId;
  label: string;
  description: string;
}

export const OPERATION_GROUPS: readonly OperationGroupDefinition[] = [
  {
    id: "seeding",
    label: "Seeding",
    description: "Planter and seeder DDIs, including shared implement values.",
  },
  {
    id: "liming",
    label: "Liming",
    description:
      "Channels whose DDI or device text explicitly identifies lime or kalk application.",
  },
  {
    id: "fertilizing",
    label: "Fertilizing",
    description:
      "Mineral fertilizer, dry spreader and slurry-application DDIs.",
  },
  {
    id: "plant-protection",
    label: "Plant protection",
    description: "Sprayer, crop-protection and weeding DDIs.",
  },
  {
    id: "harvesting",
    label: "Harvesting",
    description: "Combine, root and forage harvester DDIs.",
  },
  {
    id: "soil-work",
    label: "Soil work",
    description: "Primary and secondary tillage DDIs.",
  },
  {
    id: "other",
    label: "Other",
    description: "Channels with no matching operation evidence.",
  },
];

const limeTerms = /\b(lime|liming|limestone|kalk|kalkning|kalker)\b/i;
const seedingTerms =
  /\b(seed|seeding|seeder|planter|sowing|såning|såmaskine)\b/i;
const fertilizerTerms =
  /\b(fertilizer|fertilizing|fertiliser|spreader|slurry|manure|gødning|gødskning)\b/i;
const plantProtectionTerms =
  /\b(spray|sprayer|spraying|plant protection|crop protection|pesticide|herbicide|fungicide|planteværn|sprøjte)\b/i;
const harvestingTerms =
  /\b(harvest|harvester|combine|forage|root harvester|høst|mejetærsker)\b/i;
const soilWorkTerms =
  /\b(tillage|cultivator|plough|plow|harrow|jordbearbejdning|plov|harve)\b/i;

export function operationGroupsForChannel(
  channel: TimeLogChannel,
  deviceClassIds: readonly number[] = [],
): OperationGroupId[] {
  const evidence = [
    channel.ddiName,
    channel.deviceName,
    channel.deviceElementName,
    channel.label,
  ]
    .filter(Boolean)
    .join(" ");
  const result = new Set<OperationGroupId>();
  const isLiming = limeTerms.test(evidence);
  if (isLiming) result.add("liming");
  if (deviceClassIds.includes(4) || seedingTerms.test(evidence)) {
    result.add("seeding");
  }
  if (
    !isLiming &&
    (deviceClassIds.includes(5) ||
      deviceClassIds.includes(25) ||
      fertilizerTerms.test(evidence))
  ) {
    result.add("fertilizing");
  }
  if (
    deviceClassIds.includes(6) ||
    deviceClassIds.includes(27) ||
    plantProtectionTerms.test(evidence)
  ) {
    result.add("plant-protection");
  }
  if (
    [7, 8, 9].some((deviceClass) => deviceClassIds.includes(deviceClass)) ||
    harvestingTerms.test(evidence)
  ) {
    result.add("harvesting");
  }
  if (
    [2, 3].some((deviceClass) => deviceClassIds.includes(deviceClass)) ||
    soilWorkTerms.test(evidence)
  ) {
    result.add("soil-work");
  }
  return result.size ? [...result] : ["other"];
}
