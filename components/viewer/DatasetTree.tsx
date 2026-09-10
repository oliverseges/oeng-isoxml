"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  Box,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  FileArchive,
  FileCode2,
  FilterX,
  Grid3X3,
  Info,
  Layers3,
  ListFilter,
  Map as MapIcon,
  Route,
  Search,
  SearchX,
  SlidersHorizontal,
  Sprout,
  Tractor,
  Warehouse,
} from "lucide-react";
import {
  OPERATION_GROUPS,
  operationGroupsForChannel,
  type OperationGroupId,
} from "@/lib/isoxml/operation-groups";
import {
  hasExecutedChannelQualityFilters,
  passesExecutedChannelQualityFilters,
  SHOW_ALL_CHANNEL_FILTERS,
  summarizeTimeLogChannel,
  USEFUL_CHANNEL_FILTERS,
  type ExecutedChannelQualityFilters,
  type TimeLogChannelMetrics,
} from "@/lib/isoxml/timelog-channel-quality";
import type { IsoXmlDataset, IsoXmlObject } from "@/lib/isoxml/types";
import { createI18n } from "@/lib/client/i18n";
import { useViewerStore } from "./store";
import {
  emptyExecutedContainerIds,
  executedChannelTreeLabel,
  isTreeChannelActive,
  isTreeNodeInDataScope,
  toggleCollapsedTreeNodeId,
  treeContainerNeedsActivation,
  treeNodeTogglesChildrenOnClick,
  type TreeDataScope,
} from "./tree-selection";

type TreeNode = {
  id: string;
  label: string;
  meta?: string;
  depth: number;
  kind:
    | "dataset"
    | "section"
    | "task"
    | "grid"
    | "timelog"
    | "channel"
    | "file"
    | "device"
    | "customer"
    | "farm"
    | "validation"
    | "map";
  gridInstanceId?: string;
  timeLogInstanceId?: string;
  taskInstanceId?: string;
  channelId?: string;
  timeLogChannelId?: string;
  boundaryId?: string;
  warning?: boolean;
  parentId?: string;
  spatial?: boolean;
  hasChildren?: boolean;
  warningMessage?: string;
  hoverLabel?: string;
  objectId?: string;
  ddiDisplay?: string;
  dataScope?: Exclude<TreeDataScope, "both">;
  operationGroupIds?: OperationGroupId[];
  qualityMetrics?: TimeLogChannelMetrics;
};

const iconByKind = {
  dataset: Database,
  section: Box,
  task: Sprout,
  grid: Grid3X3,
  timelog: Route,
  channel: Layers3,
  file: FileCode2,
  device: Tractor,
  customer: Building2,
  farm: Warehouse,
  validation: AlertTriangle,
  map: MapIcon,
};

function containsExecutedData(object: IsoXmlObject): boolean {
  if (object.elementType === "TLG" || object.elementType === "DLV") {
    return true;
  }

  return object.children.some(containsExecutedData);
}

function formatMemorySize(bytes: number, locale: string): string {
  return bytes >= 1024 * 1024
    ? `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(bytes / (1024 * 1024))} MiB`
    : `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(bytes / 1024)} KiB`;
}

interface DatasetTreeProps {
  dataset: IsoXmlDataset;
  search: string;
  onSearchChange: (value: string) => void;
}

export function DatasetTree({
  dataset,
  search,
  onSearchChange,
}: DatasetTreeProps) {
  const locale = useViewerStore((state) => state.locale);
  const i18n = createI18n(locale);
  const [filterMode, setFilterMode] = useState<"all" | "issues" | "spatial">(
    "all",
  );
  const [operationFilter, setOperationFilter] = useState<
    "all" | OperationGroupId
  >("all");
  const [dataScope, setDataScope] = useState<TreeDataScope>("both");
  const [ddiFilter, setDdiFilter] = useState("all");
  const [qualityFilters, setQualityFilters] =
    useState<ExecutedChannelQualityFilters>(() => ({
      ...USEFUL_CHANNEL_FILTERS,
    }));
  const [deviceClassesByDdi, setDeviceClassesByDdi] = useState<
    Record<string, number[]>
  >({});
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeChannelId = useViewerStore((state) => state.activeChannelId);
  const activeBoundaryId = useViewerStore((state) => state.activeBoundaryId);
  const activeGridInstanceId = useViewerStore(
    (state) => state.activeGridInstanceId,
  );
  const activeTimeLogChannelId = useViewerStore(
    (state) => state.activeTimeLogChannelId,
  );
  const activeTimeLogInstanceId = useViewerStore(
    (state) => state.activeTimeLogInstanceId,
  );
  const setActiveChannel = useViewerStore((state) => state.setActiveChannel);
  const setActiveBoundary = useViewerStore((state) => state.setActiveBoundary);
  const setActiveTimeLogChannel = useViewerStore(
    (state) => state.setActiveTimeLogChannel,
  );
  const setActiveTimeLog = useViewerStore((state) => state.setActiveTimeLog);
  const setBottomTab = useViewerStore((state) => state.setBottomTab);
  const setInspectorTab = useViewerStore((state) => state.setInspectorTab);
  const requestMapFit = useViewerStore((state) => state.requestMapFit);
  const executedChannels = useMemo(
    () =>
      (dataset.timeLogs ?? []).flatMap((timeLog) =>
        timeLog.channels.map((channel) => ({ timeLog, channel })),
      ),
    [dataset.timeLogs],
  );
  const executedDdiKey = useMemo(
    () =>
      [...new Set(executedChannels.map(({ channel }) => channel.ddi))]
        .sort((left, right) => left - right)
        .join(","),
    [executedChannels],
  );
  const channelMetricsById = useMemo(
    () =>
      new Map(
        executedChannels.map(({ timeLog, channel }) => [
          channel.channelId,
          summarizeTimeLogChannel(timeLog, channel),
        ]),
      ),
    [executedChannels],
  );
  const qualityVisibleChannels = useMemo(
    () =>
      executedChannels.filter(({ channel }) => {
        const metrics = channelMetricsById.get(channel.channelId);
        return (
          metrics &&
          passesExecutedChannelQualityFilters(metrics, qualityFilters)
        );
      }),
    [channelMetricsById, executedChannels, qualityFilters],
  );
  const hiddenByQualityCount =
    executedChannels.length - qualityVisibleChannels.length;
  const qualityCounts = useMemo(() => {
    const metrics = [...channelMetricsById.values()];
    return {
      empty: metrics.filter((entry) => entry.presentCount === 0).length,
      missingPresentation: metrics.filter((entry) => entry.missingPresentation)
        .length,
      allZero: metrics.filter((entry) => entry.allZero).length,
      constant: metrics.filter((entry) => entry.constantValue).length,
      noPosition: metrics.filter((entry) => entry.noValidPosition).length,
      singlePosition: metrics.filter((entry) => entry.singlePosition).length,
      sparse: metrics.filter((entry) => entry.sparse).length,
    };
  }, [channelMetricsById]);
  const qualityOptions: Array<{
    key: keyof ExecutedChannelQualityFilters;
    label: string;
    description: string;
    count: number;
  }> = [
    {
      key: "hideEmpty",
      label: i18n.t("No recorded values"),
      description: i18n.t("Hide DLV channels that never occur in the binary records."),
      count: qualityCounts.empty,
    },
    {
      key: "hideMissingPresentation",
      label: i18n.t("Missing value presentation"),
      description: i18n.t(
        "Hide channels without a resolved device value presentation; raw integers remain available in Show all.",
      ),
      count: qualityCounts.missingPresentation,
    },
    {
      key: "hideAllZero",
      label: i18n.t("All values are zero"),
      description: i18n.t("Uses the declared value presentation when checking zero."),
      count: qualityCounts.allZero,
    },
    {
      key: "hideConstant",
      label: i18n.t("All values are constant"),
      description: i18n.t("Hide channels with one repeated displayed value."),
      count: qualityCounts.constant,
    },
    {
      key: "hideNoPosition",
      label: i18n.t("No valid location"),
      description: i18n.t("Hide channels with no value attached to a valid position."),
      count: qualityCounts.noPosition,
    },
    {
      key: "hideSinglePosition",
      label: i18n.t("Only one location"),
      description: i18n.t(
        "Hide channels whose valid positioned values fit within a five-metre cluster.",
      ),
      count: qualityCounts.singlePosition,
    },
    {
      key: "hideSparse",
      label: i18n.t("Fewer than three values"),
      description: i18n.t("Hide very sparse channels even when their positions differ."),
      count: qualityCounts.sparse,
    },
  ];
  const qualityFilterActive = hasExecutedChannelQualityFilters(qualityFilters);
  const hasActiveFilter =
    filterMode !== "all" ||
    dataScope !== "both" ||
    operationFilter !== "all" ||
    ddiFilter !== "all" ||
    qualityFilterActive ||
    Boolean(search.trim());

  useEffect(() => {
    let active = true;
    const ddis = executedDdiKey
      ? executedDdiKey.split(",").map((value) => Number(value))
      : [];
    if (!ddis.length) {
      setDeviceClassesByDdi({});
      return;
    }
    void import("@/lib/isoxml/ddi-catalog").then(({ describeDdiDetails }) => {
      if (!active) return;
      setDeviceClassesByDdi(
        Object.fromEntries(
          ddis.map((ddi) => [
            String(ddi),
            describeDdiDetails(ddi).deviceClasses.map(
              (deviceClass) => deviceClass.id,
            ),
          ]),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [executedDdiKey]);

  const operationCounts = useMemo(() => {
    const counts = new Map<OperationGroupId, number>();
    for (const { channel } of qualityVisibleChannels) {
      for (const group of operationGroupsForChannel(
        channel,
        deviceClassesByDdi[String(channel.ddi)] ?? [],
      )) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }
    return counts;
  }, [deviceClassesByDdi, qualityVisibleChannels]);

  const ddiOptions = useMemo(() => {
    const byDdi = new Map<
      string,
      { display: string; name: string; count: number }
    >();
    for (const { channel } of qualityVisibleChannels) {
      const current = byDdi.get(channel.ddiDisplay);
      byDdi.set(channel.ddiDisplay, {
        display: channel.ddiDisplay,
        name: channel.ddiName,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...byDdi.values()].sort((left, right) =>
      left.display.localeCompare(right.display),
    );
  }, [qualityVisibleChannels]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const allNodes = useMemo(() => {
    const unknownCount = dataset.issues.filter(
      (issue) => issue.code === "VIEWER_UNKNOWN_ELEMENT",
    ).length;
    const errorCount = dataset.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    const warningCount = dataset.issues.filter(
      (issue) => issue.severity === "warning",
    ).length;
    const infoCount = dataset.issues.filter(
      (issue) => issue.severity === "info",
    ).length;
    const actionableIssueCount = errorCount + warningCount;
    const next: TreeNode[] = [
      {
        id: "dataset",
        label: dataset.title,
        meta: `v${dataset.versionMajor ?? "?"}.${dataset.versionMinor ?? "?"}`,
        depth: 0,
        kind: "dataset",
      },
      {
        id: "import-summary",
        label: i18n.t("Import summary"),
        meta: i18n.t("counts.files", { count: dataset.files.length }),
        depth: 1,
        kind: "section",
        parentId: "dataset",
      },
      {
        id: "validation",
        label: i18n.t("Validation"),
        meta: actionableIssueCount
          ? i18n.t("counts.issues", { count: actionableIssueCount })
          : infoCount
            ? i18n.t("counts.notes", { count: infoCount })
            : i18n.t("No issues"),
        depth: 1,
        kind: "validation",
        warning: actionableIssueCount > 0,
        warningMessage: actionableIssueCount
          ? i18n.t("{errors} and {warnings}. Click this row to open the validation report.", {
              errors: i18n.t("counts.errors", { count: errorCount }),
              warnings: i18n.t("counts.warnings", { count: warningCount }),
            })
          : i18n.t("{notes} available. Click this row to open the validation report.", {
              notes: i18n.t("counts.notes", { count: infoCount }),
            }),
        parentId: "dataset",
      },
    ];

    const customers = dataset.objects.filter(
      (object) => object.elementType === "CTR",
    );
    const farms = dataset.objects.filter(
      (object) => object.elementType === "FRM",
    );
    if (customers.length || farms.length) {
      next.push({
        id: "customers-farms",
        label: i18n.t("Customers & farms"),
        meta: `${i18n.formatInteger(customers.length)} CTR · ${i18n.formatInteger(farms.length)} FRM`,
        depth: 1,
        kind: "section",
        parentId: "dataset",
      });
      for (const [customerIndex, customer] of customers.entries()) {
        next.push({
          id: `customer:${customer.uid}:${customerIndex}`,
          label:
            customer.attributes.B ??
            customer.attributes.CustomerDesignator ??
            customer.id ??
            i18n.t("Unnamed customer"),
          meta: customer.id ?? "CTR",
          depth: 2,
          kind: "customer",
          objectId: customer.id,
          parentId: "customers-farms",
        });
      }
      for (const [farmIndex, farm] of farms.entries()) {
        const customerId = farm.attributes.I ?? farm.attributes.CustomerIdRef;
        const matchingCustomerIndexes = customers.flatMap((candidate, index) =>
          candidate.id === customerId ? [index] : [],
        );
        const matchingFarmOrdinal = farms
          .slice(0, farmIndex)
          .filter(
            (candidate) =>
              (candidate.attributes.I ?? candidate.attributes.CustomerIdRef) ===
              customerId,
          ).length;
        const customerIndex =
          matchingCustomerIndexes[
            Math.min(matchingFarmOrdinal, matchingCustomerIndexes.length - 1)
          ];
        const customer =
          customerIndex === undefined ? undefined : customers[customerIndex];
        next.push({
          id: `farm:${farm.uid}:${farmIndex}`,
          label:
            farm.attributes.B ??
            farm.attributes.FarmDesignator ??
            farm.id ??
            i18n.t("Unnamed farm"),
          meta: farm.id ?? "FRM",
          depth: customer ? 3 : 2,
          kind: "farm",
          objectId: farm.id,
          parentId: customer
            ? `customer:${customer.uid}:${customerIndex}`
            : "customers-farms",
        });
      }
    }

    next.push({
      id: "tasks",
      label: i18n.t("Tasks"),
      meta: i18n.formatInteger(dataset.tasks.length),
      depth: 1,
      kind: "section",
      parentId: "dataset",
    });

    for (const task of dataset.tasks) {
      const taskObject = dataset.objects.find(
        (object) => object.uid === task.objectUid,
      );
      const fieldId =
        task.fieldId ??
        taskObject?.attributes.E ??
        taskObject?.attributes.PartfieldIdRef;
      const fieldObject = dataset.objects.find(
        (object) => object.elementType === "PFD" && object.id === fieldId,
      );
      const fieldName =
        fieldObject?.attributes.C ??
        fieldObject?.attributes.PartfieldDesignator ??
        fieldObject?.attributes.B ??
        task.fieldName;
      next.push({
        id: `task:${task.instanceId}`,
        label: task.name,
        meta: task.id,
        depth: 2,
        kind: "task",
        warning: task.issueCount > 0,
        warningMessage: i18n.t("{issues} relate to this task or its grids.", {
          issues: i18n.t("counts.issues", { count: task.issueCount }),
        }),
        parentId: "tasks",
        taskInstanceId: task.instanceId,
      });
      next.push({
        id: `field:${task.instanceId}`,
        label: fieldName ?? i18n.t("Field unresolved"),
        meta: fieldId ? `${fieldId} · ${i18n.t("Geometry")}` : i18n.t("Geometry"),
        depth: 3,
        kind: "map",
        parentId: `task:${task.instanceId}`,
        taskInstanceId: task.instanceId,
        spatial: true,
      });
      const importedBoundaries = dataset.boundaries.filter(
        (boundary) =>
          boundary.taskId === task.id &&
          boundary.sourceObjectUid.startsWith("shape:"),
      );
      if (importedBoundaries.length) {
        next.push({
          id: `boundaries:${task.instanceId}`,
          label: i18n.t("Boundary overlays"),
          meta: i18n.formatInteger(importedBoundaries.length),
          depth: 3,
          kind: "section",
          parentId: `task:${task.instanceId}`,
          taskInstanceId: task.instanceId,
          spatial: true,
        });
        importedBoundaries.forEach((boundary, index) => {
          next.push({
            id: `boundary:${task.instanceId}:${boundary.id}:${index}`,
            label: boundary.name,
            meta: i18n.t("counts.points", {
              count: boundary.coordinates.length,
            }),
            depth: 4,
            kind: "map",
            parentId: `boundaries:${task.instanceId}`,
            taskInstanceId: task.instanceId,
            boundaryId: boundary.id,
            spatial: true,
            hoverLabel:
              i18n.t(
                "Imported shapefile boundary overlay. Click to use this overlay for clipping and map fitting.",
              ),
          });
        });
      }
      next.push({
        id: `planned:${task.instanceId}`,
        label: i18n.t("Planned data"),
        meta: i18n.t("counts.grids", { count: task.gridIds.length }),
        depth: 3,
        kind: "section",
        dataScope: "planned",
        parentId: `task:${task.instanceId}`,
        taskInstanceId: task.instanceId,
        spatial: true,
      });
      for (const grid of dataset.grids.filter(
        (candidate) => candidate.taskInstanceId === task.instanceId,
      )) {
        next.push({
          id: `grid:${grid.instanceId}`,
          label: grid.name,
          meta: `${i18n.formatInteger(grid.rows)}×${i18n.formatInteger(grid.columns)} · ${i18n.t("Type")} ${grid.gridType}`,
          depth: 4,
          kind: "grid",
          dataScope: "planned",
          gridInstanceId: grid.instanceId,
          taskInstanceId: task.instanceId,
          warning: grid.validationIssues.some(
            (issue) => issue.severity !== "info",
          ),
          warningMessage:
            grid.validationIssues.find((issue) => issue.severity !== "info")
              ?.message ?? i18n.t("This grid has validation issues."),
          parentId: `planned:${task.instanceId}`,
          spatial: true,
        });
        grid.channels.forEach((channel) => {
          const productLabel = channel.productName ?? i18n.t("Unresolved product");
          const unitLabel = channel.presentation.unit ?? i18n.t("unit ?");
          next.push({
            id: `channel:${grid.instanceId}:${channel.pdvObjectUid}:${channel.pdvIndex}`,
            label: `DDI ${channel.ddiDisplay} · ${productLabel}`,
            meta: `${unitLabel} · PDV ${channel.pdvIndex + 1}`,
            hoverLabel: `DDI ${channel.ddiDisplay} · ${channel.ddiName}\n${i18n.t("Product")}: ${productLabel}\n${channel.presentation.unit ?? i18n.t("Unit unknown")} · PDV ${channel.pdvIndex + 1}`,
            depth: 5,
            kind: "channel",
            dataScope: "planned",
            gridInstanceId: grid.instanceId,
            taskInstanceId: task.instanceId,
            channelId: channel.channelId,
            warning: channel.presentation.confidence !== "declared",
            warningMessage:
              channel.presentation.confidence === "missing"
                ? i18n.t("The value presentation is missing; raw values are still available.")
                : channel.presentation.confidence === "invalid"
                  ? i18n.t("The declared value presentation is invalid.")
                  : undefined,
            parentId: `grid:${grid.instanceId}`,
            spatial: true,
          });
        });
      }
      const taskTimeLogs = (dataset.timeLogs ?? []).filter(
        (candidate) => candidate.taskInstanceId === task.instanceId,
      );
      if (
        taskTimeLogs.length ||
        (taskObject && containsExecutedData(taskObject))
      ) {
        next.push({
          id: `executed:${task.instanceId}`,
          label: i18n.t("Executed data"),
          meta: taskTimeLogs.length
            ? i18n.t("counts.logs", { count: taskTimeLogs.length })
            : i18n.t("Unavailable"),
          depth: 3,
          kind: "section",
          dataScope: "executed",
          parentId: `task:${task.instanceId}`,
          taskInstanceId: task.instanceId,
          spatial: true,
        });
        for (const timeLog of taskTimeLogs) {
          next.push({
            id: `timelog:${timeLog.instanceId}`,
            label: timeLog.id,
            meta:
              timeLog.adapterSelection.mode === "unresolved"
                ? i18n.t("Choose adapter")
                : i18n.t("counts.records", {
                    count: timeLog.decodedRecordCount,
                  }),
            hoverLabel: `${timeLog.adapterSelection.adapterLabel ?? i18n.t("No adapter selected")}\n${timeLog.adapterSelection.reason}`,
            depth: 4,
            kind: "timelog",
            dataScope: "executed",
            timeLogInstanceId: timeLog.instanceId,
            taskInstanceId: task.instanceId,
            warning:
              timeLog.adapterSelection.mode === "unresolved" ||
              timeLog.validationIssues.some(
                (entry) => entry.severity !== "info",
              ),
            warningMessage:
              timeLog.adapterSelection.mode === "unresolved"
                ? timeLog.adapterSelection.reason
                : (timeLog.validationIssues.find(
                    (entry) => entry.severity !== "info",
                  )?.message ?? i18n.t("This time log has validation issues.")),
            parentId: `executed:${task.instanceId}`,
            spatial: true,
          });
          timeLog.channels.forEach((channel) => {
            const qualityMetrics = channelMetricsById.get(channel.channelId);
            const presentCount = qualityMetrics?.presentCount ?? 0;
            const operationGroupIds = operationGroupsForChannel(
              channel,
              deviceClassesByDdi[String(channel.ddi)] ?? [],
            );
            const unitLabel = channel.unit ?? i18n.t("unit ?");
            const deviceElementLabel =
              channel.deviceElementName ?? i18n.t("Unresolved element");
            const deviceLabel = channel.deviceName ?? i18n.t("Unresolved");
            next.push({
              id: `timelog-channel:${timeLog.instanceId}:${channel.channelId}`,
              label: executedChannelTreeLabel(channel, i18n.t("Unknown DDI")),
              meta: `${unitLabel} · ${i18n.t("counts.values", {
                count: presentCount,
              })}`,
              hoverLabel: `DDI ${channel.ddiDisplay} · ${channel.ddiName}\n${i18n.t("Device element")}: ${deviceElementLabel}\n${i18n.t("Device")}: ${deviceLabel}\n${channel.presentation.unit ?? i18n.t("Unit unknown")}`,
              depth: 5,
              kind: "channel",
              dataScope: "executed",
              timeLogInstanceId: timeLog.instanceId,
              taskInstanceId: task.instanceId,
              timeLogChannelId: channel.channelId,
              ddiDisplay: channel.ddiDisplay,
              operationGroupIds,
              qualityMetrics,
              warning: channel.presentation.confidence !== "declared",
              warningMessage:
                channel.presentation.confidence === "missing"
                  ? i18n.t("The device value presentation is missing; raw values remain available.")
                  : channel.presentation.confidence === "invalid"
                    ? i18n.t("The declared device value presentation is invalid.")
                    : undefined,
              parentId: `timelog:${timeLog.instanceId}`,
              spatial: true,
            });
          });
        }
      }
      next.push({
        id: `devices:${task.instanceId}`,
        label: i18n.t("Machines & device elements"),
        meta: `${i18n.formatInteger(dataset.objects.filter((object) => object.elementType === "DET").length)} DET`,
        depth: 3,
        kind: "device",
        parentId: `task:${task.instanceId}`,
        taskInstanceId: task.instanceId,
      });
    }
    next.push({
      id: "files",
      label: i18n.t("Files"),
      meta: i18n.formatInteger(dataset.files.length),
      depth: 1,
      kind: "file",
      parentId: "dataset",
    });
    next.push({
      id: "unknown",
      label: i18n.t("Unknown / unsupported"),
      meta: unknownCount
        ? i18n.t("counts.groups", { count: unknownCount })
        : "0",
      depth: 1,
      kind: "section",
      warningMessage: i18n.t(
        "{groups} are available in the preserved Raw source.",
        {
          groups: i18n.t("counts.unsupportedGroups", {
            count: unknownCount,
          }),
        },
      ),
      parentId: "dataset",
    });
    const parentIds = new Set(
      next.map((node) => node.parentId).filter(Boolean),
    );
    return next.map((node) => ({
      ...node,
      hasChildren: parentIds.has(node.id),
    }));
  }, [channelMetricsById, dataset, deviceClassesByDdi, i18n]);

  const nodes = useMemo(() => {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const query = search.trim().toLowerCase();
    const visibleExecutedChannelNodeIds = new Set(
      allNodes.flatMap((node) => {
        if (!node.timeLogChannelId) return [];
        if (
          node.qualityMetrics &&
          !passesExecutedChannelQualityFilters(
            node.qualityMetrics,
            qualityFilters,
          )
        ) {
          return [];
        }
        if (
          operationFilter !== "all" &&
          !node.operationGroupIds?.includes(operationFilter)
        ) {
          return [];
        }
        if (ddiFilter !== "all" && node.ddiDisplay !== ddiFilter) return [];
        return [node.id];
      }),
    );
    const emptyExecutedContainers = emptyExecutedContainerIds(
      allNodes,
      visibleExecutedChannelNodeIds,
    );
    const directMatches = new Set(
      allNodes
        .filter((node) => {
          if (!isTreeNodeInDataScope(node.dataScope, dataScope)) return false;
          if (emptyExecutedContainers.has(node.id)) return false;
          if (node.timeLogChannelId) {
            if (!visibleExecutedChannelNodeIds.has(node.id)) return false;
          }
          if (
            filterMode === "issues" &&
            !node.warning &&
            node.kind !== "validation"
          ) {
            return false;
          }
          if (filterMode === "spatial" && !node.spatial) return false;
          return (
            !query ||
            `${node.label} ${node.meta ?? ""} ${node.hoverLabel ?? ""}`
              .toLowerCase()
              .includes(query)
          );
        })
        .map((node) => node.id),
    );
    const included = new Set(directMatches);
    for (const id of directMatches) {
      let parentId = byId.get(id)?.parentId;
      while (parentId) {
        included.add(parentId);
        parentId = byId.get(parentId)?.parentId;
      }
    }
    return allNodes.filter((node) => {
      if (!included.has(node.id)) return false;
      let parentId = node.parentId;
      while (parentId) {
        if (collapsed.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentId;
      }
      return true;
    });
  }, [
    allNodes,
    collapsed,
    dataScope,
    ddiFilter,
    filterMode,
    operationFilter,
    qualityFilters,
    search,
  ]);

  useEffect(() => {
    if (dataScope === "planned") return;
    const matches = ({ channel }: (typeof executedChannels)[number]) => {
      if (ddiFilter !== "all" && channel.ddiDisplay !== ddiFilter) return false;
      return (
        operationFilter === "all" ||
        operationGroupsForChannel(
          channel,
          deviceClassesByDdi[String(channel.ddi)] ?? [],
        ).includes(operationFilter)
      );
    };
    const current = executedChannels.find(
      ({ channel }) => channel.channelId === activeTimeLogChannelId,
    );
    const currentVisible = qualityVisibleChannels.find(
      ({ channel }) => channel.channelId === activeTimeLogChannelId,
    );
    if (currentVisible && matches(currentVisible)) {
      return;
    }
    if (
      !current &&
      operationFilter === "all" &&
      ddiFilter === "all" &&
      dataScope !== "executed"
    ) {
      return;
    }
    const first = qualityVisibleChannels.find(matches);
    if (!first) return;
    setActiveTimeLogChannel(first.timeLog.instanceId, first.channel.channelId);
    requestMapFit();
  }, [
    activeTimeLogChannelId,
    dataScope,
    ddiFilter,
    deviceClassesByDdi,
    executedChannels,
    operationFilter,
    qualityVisibleChannels,
    requestMapFit,
    setActiveTimeLogChannel,
  ]);

  useEffect(() => {
    if (dataScope !== "planned") return;
    const currentVisible = dataset.grids.some((grid) =>
      grid.channels.some((channel) => channel.channelId === activeChannelId),
    );
    if (currentVisible) return;
    const firstGrid = dataset.grids.find((grid) => grid.channels.length > 0);
    const firstChannel = firstGrid?.channels[0];
    if (!firstGrid || !firstChannel) return;
    setActiveChannel(firstGrid.instanceId, firstChannel.channelId);
    requestMapFit();
  }, [
    activeChannelId,
    dataScope,
    dataset.grids,
    requestMapFit,
    setActiveChannel,
  ]);

  const expandableIds = useMemo(
    () => allNodes.filter((node) => node.hasChildren).map((node) => node.id),
    [allNodes],
  );

  // TanStack Virtual intentionally manages scroll state outside React memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 10,
  });

  const handleNode = (node: TreeNode) => {
    if (treeNodeTogglesChildrenOnClick(node)) {
      setCollapsed((current) => toggleCollapsedTreeNodeId(current, node.id));
    }
    if (node.timeLogChannelId && node.timeLogInstanceId) {
      setActiveTimeLogChannel(node.timeLogInstanceId, node.timeLogChannelId);
      requestMapFit();
      return;
    }
    if (node.kind === "timelog" && node.timeLogInstanceId) {
      if (
        !treeContainerNeedsActivation(
          node.timeLogInstanceId,
          activeTimeLogInstanceId,
        )
      ) {
        return;
      }
      const timeLog = (dataset.timeLogs ?? []).find(
        (candidate) => candidate.instanceId === node.timeLogInstanceId,
      );
      const channel = timeLog?.channels[0];
      if (timeLog && channel) {
        setActiveTimeLogChannel(timeLog.instanceId, channel.channelId);
      } else if (timeLog) {
        setActiveTimeLog(timeLog.instanceId);
      }
      requestMapFit();
      return;
    }
    if (node.channelId && node.gridInstanceId) {
      setActiveChannel(node.gridInstanceId, node.channelId);
      requestMapFit();
      return;
    }
    if (node.boundaryId) {
      const task = dataset.tasks.find(
        (candidate) => candidate.instanceId === node.taskInstanceId,
      );
      setActiveBoundary(node.boundaryId, task?.id);
      const grid = dataset.grids.find(
        (candidate) => candidate.taskInstanceId === node.taskInstanceId,
      );
      const channel = grid?.channels[0];
      if (grid && channel) {
        setActiveChannel(grid.instanceId, channel.channelId);
      } else {
        const timeLog = (dataset.timeLogs ?? []).find(
          (candidate) => candidate.taskInstanceId === node.taskInstanceId,
        );
        const timeLogChannel = timeLog?.channels[0];
        if (timeLog && timeLogChannel) {
          setActiveTimeLogChannel(timeLog.instanceId, timeLogChannel.channelId);
        } else if (timeLog) {
          setActiveTimeLog(timeLog.instanceId);
        }
      }
      requestMapFit();
      return;
    }
    if (node.kind === "grid" && node.gridInstanceId) {
      if (
        !treeContainerNeedsActivation(node.gridInstanceId, activeGridInstanceId)
      ) {
        return;
      }
      const grid = dataset.grids.find(
        (candidate) => candidate.instanceId === node.gridInstanceId,
      );
      const channel = grid?.channels[0];
      if (grid && channel) setActiveChannel(grid.instanceId, channel.channelId);
      requestMapFit();
      return;
    }
    if (node.kind === "map") {
      requestMapFit();
      return;
    }
    if (
      node.id === "validation" ||
      node.id === "unknown" ||
      (node.id.startsWith("executed:") && !node.hasChildren)
    ) {
      setBottomTab("issues");
      return;
    }
    if (node.id === "files" || node.id === "import-summary") {
      setBottomTab("files");
      return;
    }
    if (node.kind === "device") {
      const grid = dataset.grids.find(
        (candidate) => candidate.taskInstanceId === node.taskInstanceId,
      );
      const channel = grid?.channels[0];
      if (grid && channel) setActiveChannel(grid.instanceId, channel.channelId);
      setInspectorTab("relationships");
      useViewerStore.getState().setPanelCollapsed("right", false);
      return;
    }
    if (node.kind === "customer" || node.kind === "farm") {
      const task = dataset.tasks.find((candidate) =>
        node.kind === "customer"
          ? candidate.customerId === node.objectId
          : candidate.farmId === node.objectId,
      );
      const grid = dataset.grids.find(
        (candidate) => candidate.taskInstanceId === task?.instanceId,
      );
      const channel = grid?.channels[0];
      if (grid && channel) setActiveChannel(grid.instanceId, channel.channelId);
      setInspectorTab("relationships");
      useViewerStore.getState().setPanelCollapsed("right", false);
      return;
    }
  };

  const updateQualityFilter = (
    key: keyof ExecutedChannelQualityFilters,
    checked: boolean,
  ) => {
    setQualityFilters((current) => ({ ...current, [key]: checked }));
    setOperationFilter("all");
    setDdiFilter("all");
  };

  return (
    <aside
      className={`left-panel ${executedChannels.length ? "has-executed-filters" : ""}`}
      aria-label={i18n.t("Dataset navigation")}
    >
      <div className="panel-heading">
        <div>
          <small>{i18n.t("Object browser").toUpperCase()}</small>
          <h2>{i18n.t("Dataset navigator")}</h2>
        </div>
        <button
          className="panel-reset-button"
          type="button"
          aria-label={i18n.t("Clear dataset search and tree filters")}
          title={i18n.t("Clear search, data scope, operation, DDI, Issues and Spatial filters")}
          disabled={!hasActiveFilter}
          onClick={() => {
            setFilterMode("all");
            setDataScope("both");
            setOperationFilter("all");
            setDdiFilter("all");
            setQualityFilters({ ...SHOW_ALL_CHANNEL_FILTERS });
            onSearchChange("");
          }}
        >
          <FilterX size={13} />
          <span>{i18n.t("Clear filters").toUpperCase()}</span>
        </button>
      </div>
      <div className="dataset-search-row">
        <label className="dataset-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{i18n.t("Search dataset navigator")}</span>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={i18n.t("Search IDs, products, DDI, files…")}
          />
          <kbd>Ctrl K</kbd>
        </label>
      </div>
      {executedChannels.length > 0 && (
        <div className="executed-filter-row" aria-label={i18n.t("Executed DDI filters")}>
          <label title={i18n.t("Show the DDIs usually associated with an operation")}>
            <ListFilter size={13} aria-hidden="true" />
            <span className="sr-only">{i18n.t("Executed operation group")}</span>
            <select
              value={operationFilter}
              aria-label={i18n.t("Filter executed DDIs by operation group")}
              onChange={(event) => {
                setOperationFilter(
                  event.target.value as "all" | OperationGroupId,
                );
                setDdiFilter("all");
              }}
            >
              <option value="all">
                {i18n.t("All operations")} · {executedChannels.length}
              </option>
              {OPERATION_GROUPS.map((group) => {
                const count = operationCounts.get(group.id) ?? 0;
                return (
                  <option key={group.id} value={group.id} disabled={!count}>
                    {i18n.t(group.label)} · {i18n.formatInteger(count)}
                  </option>
                );
              })}
            </select>
          </label>
          <label title={i18n.t("Show every device element that records one DDI")}>
            <Layers3 size={13} aria-hidden="true" />
            <span className="sr-only">{i18n.t("Individual executed DDI")}</span>
            <select
              value={ddiFilter}
              aria-label={i18n.t("Filter executed channels by individual DDI")}
              onChange={(event) => {
                setDdiFilter(event.target.value);
                setOperationFilter("all");
              }}
            >
              <option value="all">{i18n.t("All DDIs")} · {ddiOptions.length}</option>
              {ddiOptions.map((entry) => (
                <option key={entry.display} value={entry.display}>
                  DDI {entry.display} · {entry.name} · {entry.count}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="tree-toolbar">
        <button
          className={filterMode === "issues" ? "active" : ""}
          type="button"
          aria-pressed={filterMode === "issues"}
          onClick={() =>
            setFilterMode((mode) => (mode === "issues" ? "all" : "issues"))
          }
        >
          <AlertTriangle size={13} />
          {i18n.t("Issues")}
        </button>
        <button
          type="button"
          className={filterMode === "spatial" ? "active" : ""}
          aria-pressed={filterMode === "spatial"}
          onClick={() =>
            setFilterMode((mode) => (mode === "spatial" ? "all" : "spatial"))
          }
        >
          <MapIcon size={13} />
          {i18n.t("Spatial")}
        </button>
        <label
          className={`tree-scope-filter ${dataScope !== "both" ? "active" : ""}`}
          title={i18n.t("Show planned data, executed data, or both")}
        >
          <span className="sr-only">{i18n.t("Data scope")}</span>
          <select
            value={dataScope}
            aria-label={i18n.t("Filter dataset tree by planned or executed data")}
            onChange={(event) =>
              setDataScope(event.target.value as TreeDataScope)
            }
          >
            <option value="both">{i18n.t("Both")}</option>
            <option value="planned">{i18n.t("Planned")}</option>
            <option value="executed">{i18n.t("Executed")}</option>
          </select>
        </label>
        <details className="channel-quality-menu">
          <summary
            className={qualityFilterActive ? "active" : ""}
            aria-label={i18n.t("Configure executed channel quality filters")}
          >
            <SlidersHorizontal size={13} />
            {i18n.t("Quality")}
            {hiddenByQualityCount > 0 && <b>{hiddenByQualityCount}</b>}
          </summary>
          <div className="channel-quality-popover">
            <div className="quality-preset-actions">
              <button
                type="button"
                onClick={() => {
                  setQualityFilters({ ...USEFUL_CHANNEL_FILTERS });
                  setOperationFilter("all");
                  setDdiFilter("all");
                }}
              >
                {i18n.t("Useful defaults")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQualityFilters({ ...SHOW_ALL_CHANNEL_FILTERS });
                  setOperationFilter("all");
                  setDdiFilter("all");
                }}
              >
                {i18n.t("Show all")}
              </button>
            </div>
            <div className="quality-filter-list">
              {qualityOptions.map((option) => (
                <label key={option.key} title={option.description}>
                  <input
                    type="checkbox"
                    checked={qualityFilters[option.key]}
                    onChange={(event) =>
                      updateQualityFilter(option.key, event.target.checked)
                    }
                  />
                  <span>{option.label}</span>
                  <b>{option.count}</b>
                </label>
              ))}
            </div>
            <p>
              {qualityVisibleChannels.length} {i18n.t("of")} {executedChannels.length}{" "}
              {i18n.t("executed channels shown")}
            </p>
          </div>
        </details>
        <button
          type="button"
          aria-label={
            collapsed.size
              ? i18n.t("Expand all tree nodes")
              : i18n.t("Collapse all tree nodes")
          }
          onClick={() =>
            setCollapsed(collapsed.size ? new Set() : new Set(expandableIds))
          }
        >
          {collapsed.size ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
          {collapsed.size ? i18n.t("Expand") : i18n.t("Collapse")}
        </button>
      </div>
      <div className="tree-scroll" ref={scrollRef}>
        {nodes.length ? (
          <div
            className="tree-virtual-space"
            style={{ height: virtualizer.getTotalSize() }}
            role="tree"
            aria-label={i18n.t("ISOXML objects")}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const node = nodes[virtualRow.index];
              const Icon =
                node.kind === "validation" && !node.warning
                  ? Info
                  : iconByKind[node.kind];
              const active =
                isTreeChannelActive(
                  node,
                  activeChannelId,
                  activeTimeLogChannelId,
                ) ||
                (Boolean(node.boundaryId) && node.boundaryId === activeBoundaryId) ||
                (node.kind === "timelog" &&
                  !activeTimeLogChannelId &&
                  node.timeLogInstanceId === activeTimeLogInstanceId);
              return (
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={active}
                  key={node.id}
                  className={`tree-row ${active ? "active" : ""}`}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingLeft: 10 + node.depth * 15,
                  }}
                  onClick={() => handleNode(node)}
                  title={`${node.hoverLabel ?? `${node.label}${node.meta ? ` · ${node.meta}` : ""}`}${node.warningMessage ? `\n${node.warningMessage}` : ""}`}
                >
                  {node.kind === "channel" ? (
                    <Eye size={13} className={active ? "eye-on" : ""} />
                  ) : node.hasChildren ? (
                    collapsed.has(node.id) ? (
                      <ChevronRight size={12} className="tree-chevron" />
                    ) : (
                      <ChevronDown size={12} className="tree-chevron" />
                    )
                  ) : (
                    <span className="tree-indent-dot" />
                  )}
                  <Icon size={14} className={`tree-kind-${node.kind}`} />
                  <span className="tree-label">{node.label}</span>
                  {node.warning && (
                    <AlertTriangle
                      size={12}
                      className="tree-warning"
                      aria-label={node.warningMessage}
                    >
                      <title>{node.warningMessage}</title>
                    </AlertTriangle>
                  )}
                  {node.meta && <span className="tree-meta">{node.meta}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="tree-empty">
            <SearchX size={20} />
            {i18n.t("No matching objects")}
          </div>
        )}
      </div>
      <div className="panel-footer">
        <FileArchive size={13} />
        <span>{formatMemorySize(dataset.memoryBytes, locale)} {i18n.t("in memory")}</span>
        <span className="footer-dot" />
        <span>{i18n.t("local only")}</span>
      </div>
    </aside>
  );
}
