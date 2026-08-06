import { describe, expect, it } from "vitest";
import { normalizeDocumentAnalysis } from "../src/services/model.js";

describe("normalizeDocumentAnalysis", () => {
  it("keeps a complete model summary and exactly five unique tags", () => {
    const summary = "这是一段由模型生成的完整摘要，用于说明文档目标、核心流程、关键产出和适用场景。".repeat(3);
    const analysis = normalizeDocumentAnalysis({
      summary,
      tags: ["关键词分析", "电商运营", "搜索策略", "需求洞察", "SOP沉淀", "多余标签"],
      topics: []
    }, "关键词需求分析.md", "# 正文");

    expect(analysis.summary).toBe(summary);
    expect(analysis.tags).toEqual(["关键词分析", "电商运营", "搜索策略", "需求洞察", "SOP沉淀"]);
  });

  it("repairs incomplete model tags from model topics and document context", () => {
    const analysis = normalizeDocumentAnalysis({
      summary: "围绕用户搜索需求建立关键词分析方法，并沉淀为可复用的运营流程。",
      tags: ["关键词分析"],
      topics: [
        { label: "搜索人气", type: "topic", relation: "指标", evidence: "搜索人气" },
        { label: "支付转化率", type: "topic", relation: "指标", evidence: "支付转化率" }
      ]
    }, "淘系电商_运营PRD.md", "# 关键词需求分析");

    expect(analysis.tags).toHaveLength(5);
    expect(new Set(analysis.tags).size).toBe(5);
    expect(analysis.tags.slice(0, 3)).toEqual(["关键词分析", "搜索人气", "支付转化率"]);
  });
});
