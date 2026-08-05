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
