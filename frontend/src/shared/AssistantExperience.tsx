import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export const ASSISTANT_TIMEOUT_MINUTES = 15;

export function formatAssistantError(error: unknown, fallback = "AI 生成失败") {
  const value = error instanceof Error ? error.message : String(error || "");
  if (/timeout|timed out|aborted due to timeout|operation was aborted/i.test(value)) {
    return `生成已等待 ${ASSISTANT_TIMEOUT_MINUTES} 分钟，任务已安全停止。请缩小问题范围或稍后重试。`;
  }
  return value || fallback;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function generationPhase(seconds: number) {
  if (seconds < 8) return "正在读取上下文";
  if (seconds < 30) return "正在检索相关资料";
  if (seconds < 90) return "正在组织回答";
  return "正在深度分析，请保持页面开启";
}

export function AssistantGenerationStatus({ startedAt, compact = false }: { startedAt: number; compact?: boolean }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));

  useEffect(() => {
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000))), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <span className={`assistant-generation-status ${compact ? "compact" : ""}`} role="status">
      <span className="assistant-generation-orb" aria-hidden="true"><Sparkles /><i /><b /></span>
      <span><strong>{generationPhase(elapsed)}</strong><small>已用 {formatElapsed(elapsed)} · 最长等待 {ASSISTANT_TIMEOUT_MINUTES} 分钟</small></span>
    </span>
  );
}
