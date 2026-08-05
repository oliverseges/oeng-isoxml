import { describe, expect, it } from "vitest";
import {
  emptyExecutedContainerIds,
  executedChannelTreeLabel,
  isTreeChannelActive,
  isTreeNodeInDataScope,
  toggleCollapsedTreeNodeId,
  treeContainerNeedsActivation,
  treeNodeTogglesChildrenOnClick,
} from "@/components/viewer/tree-selection";

describe("dataset-tree channel selection", () => {
  it("does not treat two missing channel identifiers as an active match", () => {
    expect(isTreeChannelActive({}, undefined, "executed-channel")).toBe(false);
    expect(isTreeChannelActive({}, "planned-channel", undefined)).toBe(false);
  });

  it("activates only the matching planned or executed channel", () => {
    expect(
      isTreeChannelActive(
        { timeLogChannelId: "executed-channel" },
        undefined,
        "executed-channel",
      ),
    ).toBe(true);
    expect(
      isTreeChannelActive(
        { timeLogChannelId: "other-channel" },
        undefined,
        "executed-channel",
      ),
    ).toBe(false);
  });

  it("toggles selectable time-log and grid branches when their row is clicked", () => {
    expect(
      treeNodeTogglesChildrenOnClick({
        hasChildren: true,
      }),
    ).toBe(true);
    expect(treeNodeTogglesChildrenOnClick({ hasChildren: false })).toBe(false);

    const collapsed = toggleCollapsedTreeNodeId(new Set(), "timelog:TLG00008");
    expect(collapsed).toEqual(new Set(["timelog:TLG00008"]));
    expect(toggleCollapsedTreeNodeId(collapsed, "timelog:TLG00008")).toEqual(
      new Set(),
    );
  });

  it("does not reactivate an already active container while collapsing it", () => {
    expect(treeContainerNeedsActivation("TLG00008#1", "TLG00008#1")).toBe(
      false,
    );
    expect(treeContainerNeedsActivation("TLG00008#1", "TLG00007#1")).toBe(true);
  });

  it("shows the DDI dictionary name in executed channel rows", () => {
    expect(
      executedChannelTreeLabel({
        ddiDisplay: "008D",
        ddiName: "Actual Work State",
      }),
    ).toBe("DDI 008D · Actual Work State");
  });

  it("filters planned and executed branches while retaining both by default", () => {
    expect(isTreeNodeInDataScope("planned", "both")).toBe(true);
    expect(isTreeNodeInDataScope("executed", "planned")).toBe(false);
    expect(isTreeNodeInDataScope("planned", "planned")).toBe(true);
    expect(isTreeNodeInDataScope(undefined, "executed")).toBe(false);
  });

  it("prunes decoded time logs and their executed branch when every DDI is filtered out", () => {
    const nodes = [
      {
        id: "executed:task-1",
        kind: "section",
        dataScope: "executed" as const,
        taskInstanceId: "task-1",
      },
      {
        id: "timelog:log-1",
        kind: "timelog",
        taskInstanceId: "task-1",
        timeLogInstanceId: "log-1",
      },
      {
        id: "channel:log-1:ddi-1",
        kind: "channel",
        taskInstanceId: "task-1",
        timeLogInstanceId: "log-1",
        timeLogChannelId: "ddi-1",
      },
    ];

    expect(emptyExecutedContainerIds(nodes, new Set())).toEqual(
      new Set(["timelog:log-1", "executed:task-1"]),
    );
    expect(
      emptyExecutedContainerIds(nodes, new Set(["channel:log-1:ddi-1"])),
    ).toEqual(new Set());
  });

  it("keeps undecoded logs visible so their adapter can still be selected", () => {
    const nodes = [
      {
        id: "executed:task-1",
        kind: "section",
        dataScope: "executed" as const,
        taskInstanceId: "task-1",
      },
      {
        id: "timelog:unresolved",
        kind: "timelog",
        taskInstanceId: "task-1",
        timeLogInstanceId: "unresolved",
      },
    ];

    expect(emptyExecutedContainerIds(nodes, new Set())).toEqual(new Set());
  });
});
