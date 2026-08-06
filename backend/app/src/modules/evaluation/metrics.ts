export function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function evaluationFailure(recall: number, accuracy: number, citationCorrect: boolean) {
  const reasons: string[] = [];
  if (recall < 0.8) reasons.push("期望文档召回不足");
  if (accuracy < 0.5) reasons.push("无关文档占比过高");
  if (!citationCorrect) reasons.push("历史引用已失效");
  return reasons.join("；") || "未达到评测阈值";
}

/**
 * Mean Reciprocal Rank (MRR)
 * 衡量第一个正确结果的排名
 * 值越高越好，范围 [0, 1]
 */
export function calculateMRR(retrieved: string[], expected: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Hit@K
 * 前 K 个结果中是否包含正确答案
 * 返回 0 或 1
 */
export function calculateHitAtK(retrieved: string[], expected: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  return expected.some(id => topK.includes(id)) ? 1 : 0;
}

/**
 * Normalized Discounted Cumulative Gain (NDCG)
 * 衡量排序质量，考虑位置权重
 * 值越高越好，范围 [0, 1]
 */
export function calculateNDCG(retrieved: string[], expected: string[], k: number): number {
  const topK = retrieved.slice(0, k);

  // 计算 DCG
  const dcg = topK.reduce((sum, id, i) => {
    const relevance = expected.includes(id) ? 1 : 0;
    return sum + relevance / Math.log2(i + 2);
  }, 0);

  // 计算理想 DCG（所有相关文档都在前面）
  const idealRelevance = Math.min(expected.length, k);
  let idealDcg = 0;
  for (let i = 0; i < idealRelevance; i++) {
    idealDcg += 1 / Math.log2(i + 2);
  }

  return idealDcg > 0 ? dcg / idealDcg : 0;
}
