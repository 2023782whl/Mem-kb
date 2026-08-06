import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphEdge, GraphNode } from "../../types/domain";
import { KnowledgeGraph, layoutGraphNodes } from "./KnowledgeGraph";

const nodes: GraphNode[] = [
  { id: "workspace", label: "运营知识库", type: "workspace", summary: "" },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `asset-${index}`,
    label: index === 23 ? "唯一目标节点" : `文档 ${index}`,
    type: index % 2 ? "document" : "topic",
    format: "md",
    summary: `摘要 ${index}`,
    assetId: index % 2 ? `asset-${index}` : null
  }))
];
const edges: GraphEdge[] = nodes.slice(1).map((node) => ({
  id: `edge-${node.id}`,
  source: "workspace",
  target: node.id,
  label: "包含"
}));

describe("KnowledgeGraph", () => {
  it("renders more than the old 15-node limit", () => {
    render(<KnowledgeGraph nodes={nodes} edges={edges} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(20);
    expect(screen.getByText("24 / 24 节点")).toBeInTheDocument();
  });

  it("filters nodes by search text", () => {
    render(<KnowledgeGraph nodes={nodes} edges={edges} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索节点"), { target: { value: "唯一目标" } });
    expect(screen.getByText("唯一目标节点")).toBeInTheDocument();
    expect(screen.queryByText("文档 1")).not.toBeInTheDocument();
  });

  it("expands dense graphs into multiple readable rings", () => {
    const denseNodes = [nodes[0], ...Array.from({ length: 35 }, (_, index) => ({ ...nodes[(index % 24) + 1], id: `dense-${index}`, label: `密集节点 ${index}` }))];
    const result = layoutGraphNodes(denseNodes);
    expect(result.width).toBeGreaterThan(1000);
    expect(result.height).toBeGreaterThan(700);
    expect(result.points.size).toBe(36);
    expect(new Set([...result.points.values()].map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)).size).toBe(36);
  });
});
