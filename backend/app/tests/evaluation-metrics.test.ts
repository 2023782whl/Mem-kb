import { describe, expect, it } from "vitest";
import { average, evaluationFailure } from "../src/modules/evaluation/metrics.js";

describe("RAG evaluation metrics", () => {
  it("averages query scores without producing NaN for empty runs", () => {
    expect(average([1, 0.5, 0])).toBe(0.5);
    expect(average([])).toBe(0);
  });

  it("reports each failed quality gate", () => {
    expect(evaluationFailure(0.4, 0.2, false)).toBe("期望文档召回不足；无关文档占比过高；历史引用已失效");
  });
});
