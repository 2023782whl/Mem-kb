import { describe, expect, it } from "vitest";
import { normalizeKnowledgeEntities } from "../src/services/knowledge-entities.js";

describe("normalizeKnowledgeEntities", () => {
  it("deduplicates normalized labels within the same entity type", () => {
    const entities = normalizeKnowledgeEntities([
      { label: "商品", type: "image-entity", relation: "视觉关联", evidence: "a" },
      { label: " 商品！", type: "image-entity", relation: "视觉关联", evidence: "b" },
      { label: "商品", type: "topic", relation: "主题关联", evidence: "c" }
    ]);

    expect(entities).toHaveLength(2);
    expect(entities.map((item) => item.normalized)).toEqual(["商品", "商品"]);
    expect(entities.map((item) => item.type)).toEqual(["image-entity", "topic"]);
  });
});
