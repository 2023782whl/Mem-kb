import { describe, expect, it } from "vitest";
import { buildDocumentTree, collapsedAtDepth, visibleDocumentTree } from "./documentTree";

describe("document tree", () => {
  it("keeps headings, lists, notes and resources in one stable tree", () => {
    const markdown = "## 策略\n背景说明\n- 动作一\n- 动作二\n### 证据\n![图](/api/assets/a/media/m)";
    const first = buildDocumentTree("运营方案", markdown);
    const second = buildDocumentTree("运营方案", markdown);
    expect(first.map((node) => node.id)).toEqual(second.map((node) => node.id));
    expect(first.some((node) => node.label === "动作一" && node.kind === "list")).toBe(true);
    expect(first.find((node) => node.label === "证据")?.resources).toEqual(["/api/assets/a/media/m"]);
  });

  it("hides descendants of collapsed branches", () => {
    const nodes = buildDocumentTree("文档", "## A\n### B\n正文");
    const branch = nodes.find((node) => node.label === "A")!;
    expect(visibleDocumentTree(nodes, new Set([branch.id])).map((node) => node.label)).not.toContain("B");
  });

  it("keeps a 200-node document stable", () => {
    const markdown = Array.from({ length: 200 }, (_, index) => `## 节点 ${index + 1}`).join("\n");
    const nodes = buildDocumentTree("长文档", markdown);
    expect(nodes).toHaveLength(201);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(201);
  });

  it("drops page markers and symbol-only headings from mind-map structure", () => {
    const nodes = buildDocumentTree("文档", "## 第 2 页\n### 核心策略\n## ```\n- 有效动作");
    expect(nodes.map((node) => node.label)).not.toContain("第 2 页");
    expect(nodes.map((node) => node.label)).not.toContain("```");
    expect(nodes.map((node) => node.label)).toContain("核心策略");
  });

  it("collapses branches after the requested visible depth", () => {
    const nodes = buildDocumentTree("文档", "## A\n### B\n#### C\n- D");
    const collapsed = collapsedAtDepth(nodes, 2);
    expect(collapsed.has(nodes.find((node) => node.label === "B")!.id)).toBe(true);
    expect(visibleDocumentTree(nodes, collapsed).map((node) => node.label)).toEqual(["文档", "A", "B"]);
  });
});
