import { describe, expect, it } from "vitest";
import { buildDocumentTree } from "./documentTree";
import { createMindMapLayout } from "./mindMapLayout";

describe("mind-map layout", () => {
  it("balances primary topics across both sides of the center", () => {
    const tree = buildDocumentTree("主题", Array.from({ length: 6 }, (_, index) => `## 分支 ${index + 1}\n- 动作 ${index + 1}`).join("\n"));
    const layout = createMindMapLayout(tree, new Set());
    const topics = layout.nodes.filter((node) => node.visualKind === "topic");
    expect(topics.filter((node) => node.side === "right")).toHaveLength(3);
    expect(topics.filter((node) => node.side === "left")).toHaveLength(3);
    expect(new Set(topics.map((node) => node.branchColor)).size).toBe(6);
    expect(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(layout.edges.every((edge) => [...edge.controlPointDistances, ...edge.controlPointWeights].every(Number.isFinite))).toBe(true);
  });

  it("keeps the center fixed and removes collapsed descendants", () => {
    const tree = buildDocumentTree("主题", "## 策略\n### 执行\n- 动作");
    const strategy = tree.find((node) => node.label === "策略")!;
    const visible = tree.filter((node) => node.id === tree[0].id || node.id === strategy.id);
    const layout = createMindMapLayout(visible, new Set([strategy.id]));
    const root = layout.nodes.find((node) => node.visualKind === "root")!;
    expect(root).toMatchObject({ x: 0, y: 0, side: "root" });
    expect(layout.nodes.some((node) => node.label === "执行")).toBe(false);
  });

  it("places every branch on the selected side", () => {
    const tree = buildDocumentTree("主题", "## A\n### A1\n## B\n### B1");
    const left = createMindMapLayout(tree, new Set(), "left");
    const right = createMindMapLayout(tree, new Set(), "right");
    expect(left.nodes.filter((node) => node.visualKind !== "root").every((node) => node.side === "left")).toBe(true);
    expect(right.nodes.filter((node) => node.visualKind !== "root").every((node) => node.side === "right")).toBe(true);
  });
});
