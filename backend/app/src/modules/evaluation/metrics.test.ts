import { describe, it, expect } from "vitest";
import { average, evaluationFailure, calculateMRR, calculateHitAtK, calculateNDCG } from "./metrics.js";

describe("evaluation metrics", () => {
  describe("average", () => {
    it("should calculate average of numbers", () => {
      expect(average([1, 2, 3, 4, 5])).toBe(3);
      expect(average([0.5, 0.8, 0.9])).toBeCloseTo(0.733, 2);
    });

    it("should return 0 for empty array", () => {
      expect(average([])).toBe(0);
    });

    it("should handle single value", () => {
      expect(average([42])).toBe(42);
    });
  });

  describe("evaluationFailure", () => {
    it("should report low recall", () => {
      const failure = evaluationFailure(0.5, 0.9, true);
      expect(failure).toContain("期望文档召回不足");
    });

    it("should report low accuracy", () => {
      const failure = evaluationFailure(0.9, 0.3, true);
      expect(failure).toContain("无关文档占比过高");
    });

    it("should report citation issues", () => {
      const failure = evaluationFailure(0.9, 0.9, false);
      expect(failure).toContain("历史引用已失效");
    });

    it("should combine multiple failures", () => {
      const failure = evaluationFailure(0.5, 0.3, false);
      expect(failure).toContain("期望文档召回不足");
      expect(failure).toContain("无关文档占比过高");
      expect(failure).toContain("历史引用已失效");
    });

    it("should return default message when passing", () => {
      const failure = evaluationFailure(0.9, 0.9, true);
      expect(failure).toBe("未达到评测阈值");
    });
  });

  describe("calculateMRR", () => {
    it("should return 1 when first result is correct", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc1"];
      expect(calculateMRR(retrieved, expected)).toBe(1);
    });

    it("should return 0.5 when second result is correct", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc2"];
      expect(calculateMRR(retrieved, expected)).toBe(0.5);
    });

    it("should return 0.333 when third result is correct", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc3"];
      expect(calculateMRR(retrieved, expected)).toBeCloseTo(0.333, 2);
    });

    it("should return 0 when no correct result", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc4"];
      expect(calculateMRR(retrieved, expected)).toBe(0);
    });

    it("should handle multiple expected documents", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc2", "doc3"];
      // 应该返回第一个匹配的位置
      expect(calculateMRR(retrieved, expected)).toBe(0.5);
    });

    it("should return 0 for empty retrieved list", () => {
      expect(calculateMRR([], ["doc1"])).toBe(0);
    });
  });

  describe("calculateHitAtK", () => {
    it("should return 1 when correct doc in top K", () => {
      const retrieved = ["doc1", "doc2", "doc3", "doc4"];
      const expected = ["doc2"];
      expect(calculateHitAtK(retrieved, expected, 3)).toBe(1);
    });

    it("should return 0 when correct doc not in top K", () => {
      const retrieved = ["doc1", "doc2", "doc3", "doc4"];
      const expected = ["doc4"];
      expect(calculateHitAtK(retrieved, expected, 2)).toBe(0);
    });

    it("should work with K=1", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      expect(calculateHitAtK(retrieved, ["doc1"], 1)).toBe(1);
      expect(calculateHitAtK(retrieved, ["doc2"], 1)).toBe(0);
    });

    it("should handle multiple expected documents", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc2", "doc5"];
      expect(calculateHitAtK(retrieved, expected, 3)).toBe(1);
    });

    it("should return 0 for empty lists", () => {
      expect(calculateHitAtK([], ["doc1"], 3)).toBe(0);
      expect(calculateHitAtK(["doc1"], [], 3)).toBe(0);
    });
  });

  describe("calculateNDCG", () => {
    it("should return 1 for perfect ranking", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc1", "doc2"];
      expect(calculateNDCG(retrieved, expected, 3)).toBeCloseTo(1, 2);
    });

    it("should return less than 1 for imperfect ranking", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc3", "doc1"];
      const ndcg = calculateNDCG(retrieved, expected, 3);
      expect(ndcg).toBeGreaterThan(0);
      expect(ndcg).toBeLessThan(1);
    });

    it("should return 0 when no relevant documents in top K", () => {
      const retrieved = ["doc1", "doc2", "doc3"];
      const expected = ["doc4", "doc5"];
      expect(calculateNDCG(retrieved, expected, 3)).toBe(0);
    });

    it("should handle K smaller than expected length", () => {
      const retrieved = ["doc1", "doc2", "doc3", "doc4"];
      const expected = ["doc1", "doc2", "doc3", "doc4"];
      const ndcg = calculateNDCG(retrieved, expected, 2);
      expect(ndcg).toBeGreaterThan(0);
      expect(ndcg).toBeLessThanOrEqual(1);
    });

    it("should penalize lower-ranked relevant documents", () => {
      const retrieved1 = ["doc1", "doc2", "doc3"];
      const retrieved2 = ["doc2", "doc1", "doc3"];
      const expected = ["doc1"];

      const ndcg1 = calculateNDCG(retrieved1, expected, 3);
      const ndcg2 = calculateNDCG(retrieved2, expected, 3);

      // doc1 在第一位的得分应该高于第二位
      expect(ndcg1).toBeGreaterThan(ndcg2);
    });

    it("should return 0 for empty lists", () => {
      expect(calculateNDCG([], ["doc1"], 3)).toBe(0);
      expect(calculateNDCG(["doc1"], [], 3)).toBe(0);
    });
  });
});
