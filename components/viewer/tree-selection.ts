export function isTreeChannelActive(
  node: { channelId?: string; timeLogChannelId?: string },
  activeChannelId?: string,
  activeTimeLogChannelId?: string,
): boolean {
  return (
    Boolean(node.channelId && node.channelId === activeChannelId) ||
    Boolean(
      node.timeLogChannelId && node.timeLogChannelId === activeTimeLogChannelId,
    )
  );
}

export function treeNodeTogglesChildrenOnClick(node: {
  hasChildren?: boolean;
}): boolean {
  return Boolean(node.hasChildren);
}

export function toggleCollapsedTreeNodeId(
  collapsedIds: ReadonlySet<string>,
  nodeId: string,
): Set<string> {
  const next = new Set(collapsedIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return next;
}

export function treeContainerNeedsActivation(
  containerInstanceId: string | undefined,
  activeContainerInstanceId: string | undefined,
): boolean {
  return Boolean(
    containerInstanceId && containerInstanceId !== activeContainerInstanceId,
  );
}

export function executedChannelTreeLabel(channel: {
  ddiDisplay: string;
  ddiName?: string;
}): string {
  const ddiName = channel.ddiName?.trim() || "Unknown DDI";
  return `DDI ${channel.ddiDisplay} · ${ddiName}`;
}

export type TreeDataScope = "both" | "planned" | "executed";

export function isTreeNodeInDataScope(
  nodeScope: Exclude<TreeDataScope, "both"> | undefined,
  selectedScope: TreeDataScope,
): boolean {
  return selectedScope === "both" || nodeScope === selectedScope;
}

export interface ExecutedTreeFilterNode {
  id: string;
  kind: string;
  dataScope?: Exclude<TreeDataScope, "both">;
  taskInstanceId?: string;
  timeLogInstanceId?: string;
  timeLogChannelId?: string;
}

export function emptyExecutedContainerIds(
  nodes: ExecutedTreeFilterNode[],
  visibleChannelNodeIds: ReadonlySet<string>,
): Set<string> {
  const timeLogNodes = nodes.filter((node) => node.kind === "timelog");
  const timeLogIdsWithChannels = new Set(
    nodes.flatMap((node) =>
      node.timeLogChannelId && node.timeLogInstanceId
        ? [node.timeLogInstanceId]
        : [],
    ),
  );
  const timeLogIdsWithVisibleChannels = new Set(
    nodes.flatMap((node) =>
      node.timeLogChannelId &&
      node.timeLogInstanceId &&
      visibleChannelNodeIds.has(node.id)
        ? [node.timeLogInstanceId]
        : [],
    ),
  );
  const hiddenTimeLogIds = new Set(
    [...timeLogIdsWithChannels].filter(
      (timeLogId) => !timeLogIdsWithVisibleChannels.has(timeLogId),
    ),
  );
  const hiddenNodeIds = new Set(
    timeLogNodes.flatMap((node) =>
      node.timeLogInstanceId && hiddenTimeLogIds.has(node.timeLogInstanceId)
        ? [node.id]
        : [],
    ),
  );

  for (const node of nodes) {
    if (node.kind !== "section" || node.dataScope !== "executed") continue;
    const taskTimeLogs = timeLogNodes.filter(
      (timeLog) => timeLog.taskInstanceId === node.taskInstanceId,
    );
    if (
      taskTimeLogs.length > 0 &&
      taskTimeLogs.every(
        (timeLog) =>
          timeLog.timeLogInstanceId !== undefined &&
          hiddenTimeLogIds.has(timeLog.timeLogInstanceId),
      )
    ) {
      hiddenNodeIds.add(node.id);
    }
  }

  return hiddenNodeIds;
}
