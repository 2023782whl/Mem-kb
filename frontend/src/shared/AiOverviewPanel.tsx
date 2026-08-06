import {
  ArrowUpRight, Check, ChevronDown, Copy, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LoadingDots } from "./LoadingSystem";

type OverviewFeedback = "up" | "down" | null;

function readStoredValue(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Reading preferences may be unavailable in private browser contexts.
  }
}

export function AiOverviewPanel({
  subjectKey,
  summary,
  keyPoints = [],
  suggestedQuestions = [],
  busy = false,
  error = "",
  defaultExpanded = false,
  onRegenerate,
  onAskQuestion
}: {
  subjectKey: string;
  summary: string;
  keyPoints?: string[];
  suggestedQuestions?: string[];
  busy?: boolean;
  error?: string;
  defaultExpanded?: boolean;
  onRegenerate?: () => Promise<void> | void;
  onAskQuestion?: (question: string) => void;
}) {
  const visibilityKey = `mem-kb:ai-overview-visible:${subjectKey}`;
  const feedbackKey = `mem-kb:ai-overview-feedback:${subjectKey}`;
  const [visible, setVisible] = useState(() => readStoredValue(visibilityKey, "1") !== "0");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<OverviewFeedback>(() => {
    const value = readStoredValue(feedbackKey, "");
    return value === "up" || value === "down" ? value : null;
  });
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    setVisible(readStoredValue(visibilityKey, "1") !== "0");
    const storedFeedback = readStoredValue(feedbackKey, "");
    setFeedback(storedFeedback === "up" || storedFeedback === "down" ? storedFeedback : null);
    setExpanded(defaultExpanded);
  }, [defaultExpanded, feedbackKey, visibilityKey]);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  async function copySummary() {
    if (!summary) return;
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1_600);
  }

  function closeOverview() {
    setVisible(false);
    storeValue(visibilityKey, "0");
  }

  function restoreOverview() {
    setVisible(true);
    storeValue(visibilityKey, "1");
  }

  function rate(value: Exclude<OverviewFeedback, null>) {
    const next = feedback === value ? null : value;
    setFeedback(next);
    storeValue(feedbackKey, next || "");
  }

  if (!visible) {
    return <button type="button" className="ai-overview-restore" onClick={restoreOverview} title="重新显示 AI 概览">
      <Sparkles />AI 概览
    </button>;
  }

  return (
    <section className={`ai-overview ${expanded ? "expanded" : ""} ${busy ? "loading" : ""}`} aria-label="AI 概览">
      <header>
        <strong><Sparkles />AI 概览</strong>
        <span>
          <button type="button" onClick={() => void copySummary()} disabled={!summary || busy} title={copied ? "已复制摘要" : "复制摘要"} aria-label={copied ? "已复制摘要" : "复制摘要"}>{copied ? <Check /> : <Copy />}</button>
          {onRegenerate ? <button type="button" onClick={() => void onRegenerate()} disabled={busy} title="重新生成 AI 概览"><RefreshCw /></button> : null}
          <button type="button" className="ai-overview-toggle" onClick={() => setExpanded((value) => !value)} title={expanded ? "收起 AI 概览" : "展开 AI 概览"}><ChevronDown /></button>
          <button type="button" onClick={closeOverview} title="关闭 AI 概览"><X /></button>
        </span>
      </header>
      {busy && !summary ? <div className="ai-overview-loading"><LoadingDots /><span>正在生成概览</span></div> : null}
      {summary ? <p className="ai-overview-summary" data-i18n-ignore>{summary}</p> : null}
      {error ? <p className="ai-overview-error" role="alert">{error}</p> : null}
      {expanded && keyPoints.length ? <section className="ai-overview-points">
        <h3>关键要点</h3>
        <ul>{keyPoints.map((point, index) => <li key={`${point}-${index}`} data-i18n-ignore>{point}</li>)}</ul>
      </section> : null}
      {expanded && suggestedQuestions.length && onAskQuestion ? <section className="ai-follow-ups">
        <h3>推荐追问</h3>
        <div>{suggestedQuestions.map((question, index) => <button type="button" key={`${question}-${index}`} onClick={() => onAskQuestion(question)} title={`询问助手：${question}`}><span data-i18n-ignore>{question}</span><ArrowUpRight /></button>)}</div>
      </section> : null}
      {expanded && summary ? <footer className="ai-overview-feedback">
        <span>这个概览有帮助吗？</span>
        <button type="button" className={feedback === "up" ? "active" : ""} aria-pressed={feedback === "up"} onClick={() => rate("up")} title="概览有帮助"><ThumbsUp /></button>
        <button type="button" className={feedback === "down" ? "active" : ""} aria-pressed={feedback === "down"} onClick={() => rate("down")} title="概览没有帮助"><ThumbsDown /></button>
      </footer> : null}
    </section>
  );
}
