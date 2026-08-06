import { env } from "../../config/env.js";

export const MODEL_GENERATION_TIMEOUT_MS = env.model.requestTimeoutMs;

export function modelFailureMessage(error: unknown, fallback = "模型生成失败") {
  const value = error instanceof Error ? error.message : String(error || "");
  const timedOut = (error instanceof Error && error.name === "TimeoutError")
    || /timeout|timed out|aborted due to timeout|operation was aborted/i.test(value);
  if (timedOut) {
    const minutes = Math.round(MODEL_GENERATION_TIMEOUT_MS / 60_000);
    return `模型生成已等待 ${minutes} 分钟，任务已安全停止。请缩小问题范围或稍后重试。`;
  }
  return value || fallback;
}
