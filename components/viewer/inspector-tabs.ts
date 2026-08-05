import type { InspectorTab } from "./store";

export interface InspectorTabDefinition {
  id: InspectorTab;
  label: string;
}

export const INSPECTOR_TABS: readonly InspectorTabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "attributes", label: "Attributes" },
  { id: "relationships", label: "Relations" },
  { id: "source", label: "Source" },
  { id: "validation", label: "Validation" },
];

export const TIME_LOG_INSPECTOR_TABS: readonly InspectorTabDefinition[] = [
  ...INSPECTOR_TABS,
  { id: "adapter", label: "Adapter" },
];

export function visibleInspectorTab(
  tab: InspectorTab,
  adapterAvailable: boolean,
): InspectorTab {
  return tab === "adapter" && !adapterAvailable ? "overview" : tab;
}
