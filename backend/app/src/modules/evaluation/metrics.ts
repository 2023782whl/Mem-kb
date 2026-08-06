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
