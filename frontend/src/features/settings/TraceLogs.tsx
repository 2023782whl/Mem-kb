import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MessageSquareText, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { QaTrace, QaTraceDetail, User } from "../../types/domain";
import { useI18n, type AppLocale } from "../../i18n";

const PAGE_SIZE = 24;

export function TraceLogs({ users }: { users: User[] }) {
  const { locale } = useI18n();
  const [items, setItems] = useState<QaTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({ status: "", rating: "", issueType: "", userId: "", source: "", search: "" });
  const [detail, setDetail] = useState<QaTraceDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.traces({ ...filters, offset, limit: PAGE_SIZE });
      setItems(result.items);
      setTotal(result.total);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trace 加载失败");
    }
  }, [filters, offset]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  function patchFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOffset(0);
  }

  async function openDetail(id: string) {
    try { setDetail(await api.trace(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Trace 详情加载失败"); }
  }

  return <div className="settings-content trace-settings">
    <header className="settings-section-head"><div><h1>对话 Trace</h1><p>查看检索、模型、持久化与渠道投递的完整执行链路。</p></div></header>
    {error ? <div className="inline-notice">{error}</div> : null}
    <div className="trace-filters"><label className="trace-search"><Search /><input value={filters.search} onChange={(event) => patchFilter("search", event.target.value)} placeholder="搜索问题或回答" /></label><select value={filters.status} onChange={(event) => patchFilter("status", event.target.value)}><option value="">全部状态</option><option value="completed">已完成</option><option value="running">执行中</option><option value="failed">失败</option><option value="cancelled">已取消</option></select><select value={filters.rating} onChange={(event) => patchFilter("rating", event.target.value)}><option value="">全部评价</option><option value="up">好评</option><option value="down">差评</option><option value="unrated">未评价</option></select><select value={filters.issueType} onChange={(event) => patchFilter("issueType", event.target.value)}><option value="">全部问题</option><option value="none">无问题</option><option value="user_feedback">用户反馈</option><option value="retrieval">知识召回</option><option value="model">模型问题</option><option value="channel">渠道问题</option><option value="cancelled">用户取消</option></select><select value={filters.source} onChange={(event) => patchFilter("source", event.target.value)}><option value="">全部来源</option><option value="web">网页</option><option value="wechat">微信</option></select><select value={filters.userId} onChange={(event) => patchFilter("userId", event.target.value)}><option value="">全部用户</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div>
    <div className="trace-table"><header><span>对话任务</span><span>用户</span><span>来源</span><span>状态</span><span>问题原因</span><span>最近内容</span><span>时间</span><span /></header>{items.map((trace) => <button key={trace.id} onClick={() => void openDetail(trace.id)}><span><strong>{trace.question}</strong><em>{trace.workspace_name || trace.workspace_id}</em></span><span>{trace.user_name || trace.user_id}</span><span><SourceBadge source={trace.source} /></span><span><TraceStatus trace={trace} /></span><span>{issueLabel(trace.issue_type)}</span><span>{trace.answer_preview || trace.error || "正在处理"}</span><span>{formatTraceTime(trace.created_at, locale)}</span><span>查看</span></button>)}{!items.length ? <div className="trace-empty"><MessageSquareText size={28} /><strong>暂无匹配的 Trace</strong><span>进行问答或通过微信发起对话后会显示在这里。</span></div> : null}</div>
    <footer className="trace-pagination"><span>共 {total} 条</span><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft /></button><strong>{Math.floor(offset / PAGE_SIZE) + 1}</strong><button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight /></button></footer>
    {detail ? <TraceDrawer detail={detail} onClose={() => setDetail(null)} /> : null}
  </div>;
}

function TraceDrawer({ detail, onClose }: { detail: QaTraceDetail; onClose: () => void }) {
  return <div className="trace-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="trace-drawer"><header><div><MessageSquareText /><span><strong>Trace 详情</strong><em>{detail.trace.id}</em></span></div><button onClick={onClose}><X /></button></header><section className="trace-summary"><div><span>状态</span><TraceStatus trace={detail.trace} /></div><div><span>来源</span><SourceBadge source={detail.trace.source} /></div><div><span>模型</span><strong>{detail.trace.model_id}</strong></div><div><span>总耗时</span><strong>{detail.trace.duration_ms ? `${detail.trace.duration_ms} ms` : "-"}</strong></div></section><section className="trace-question"><span>用户问题</span><p>{detail.trace.question}</p>{detail.trace.error ? <div className="trace-error"><AlertCircle />{detail.trace.error}</div> : null}</section><section className="trace-timeline"><h3>执行链路</h3>{detail.events.map((event) => <article key={event.id}><i className={event.status} /> <div><header><strong>{phaseLabel(event.phase)}</strong><span>{event.duration_ms ? `${event.duration_ms} ms` : event.status}</span></header><p>{event.detail || "已完成"}</p>{Object.keys(event.metadata || {}).length ? <details><summary>查看数据</summary><pre>{JSON.stringify(event.metadata, null, 2)}</pre></details> : null}</div></article>)}</section><section className="trace-conversation"><h3>对话内容</h3>{detail.messages.map((message) => <div key={message.id} className={message.role}><strong>{message.role === "user" ? "用户" : "助手"}</strong><p>{message.content}</p></div>)}</section></aside></div>;
}

function TraceStatus({ trace }: { trace: QaTrace }) { return <span className={`trace-status ${trace.status}`}>{trace.status === "completed" ? <CheckCircle2 /> : trace.status === "running" ? <Clock3 /> : <AlertCircle />}{({ completed: "已完成", running: "执行中", failed: "失败", cancelled: "已取消" } as const)[trace.status]}</span>; }
function SourceBadge({ source }: { source: QaTrace["source"] }) { return <span className={`source-badge ${source}`}>{source === "wechat" ? "微信" : "网页"}</span>; }
function issueLabel(value: string) { return ({ none: "-", user_feedback: "用户差评", retrieval: "知识召回", model: "模型调用", persistence: "结果保存", channel: "渠道处理", cancelled: "用户取消" } as Record<string, string>)[value] || value; }
function phaseLabel(value: string) { return ({ scope: "权限与范围", retrieval: "知识召回", conversation: "会话上下文", model: "模型生成", persistence: "结果保存", channel: "渠道处理" } as Record<string, string>)[value] || value; }
function formatTraceTime(value: string, locale: AppLocale) { return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); }
