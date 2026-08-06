import {
  ArrowDownToLine, Check, ChevronDown, Clock3, Copy, ExternalLink, FileText, History,
  Lightbulb, Maximize2, Minimize2, Paperclip, Plus, RotateCcw, Send, Sparkles, Square,
  Tag, Trash2, WandSparkles, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { ConfirmActionDialog, TextEntryDialog } from "../../shared/EntityDialogs";
import { LoadingDots } from "../../shared/LoadingSystem";
import { MarkdownContent } from "../../shared/MarkdownContent";
import { AssistantGenerationStatus, formatAssistantError } from "../../shared/AssistantExperience";
import { ModelPicker } from "../../shared/ModelPicker";
import type { Asset, ModelInfo, Note, NoteAssistantSource, NoteFact, NoteLifecycle } from "../../types/domain";
import { useI18n } from "../../i18n";

type InspectorTab = "ai" | "gbrain" | "facts";
type ApplyMode = "insert" | "replace" | "append";
type AssistantAction = "continue" | "rewrite" | "summarize" | "outline" | "custom";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; startedAt?: number; sources?: NoteAssistantSource[] };

const actionLabels: Record<AssistantAction, string> = {
  continue: "续写",
  rewrite: "重写",
  summarize: "总结",
  outline: "生成大纲",
  custom: "自由创作"
};

const starterQuestions = {
  "zh-CN": ["这份笔记解决了什么问题？", "有哪些关键点容易被忽略？", "提炼这份笔记最重要的 5 个结论"],
  "en-US": ["What problem does this note solve?", "Which key points are easy to overlook?", "Summarize the five most important conclusions in this note"]
} as const;

function assistantRole(model: ModelInfo) {
  const value = `${model.id} ${model.name}`.toLowerCase();
  if (value.includes("claude")) return "严谨编辑";
  if (value.includes("gemini")) return "资料研究员";
  if (value.includes("doubao") || value.includes("qwen") || value.includes("glm")) return "快速整理";
  return "写作搭档";
}

export function NoteInspector({
  note, assets, selection, cursorContext, onApply, onTagsChange, onAutoPublishChange,
  onReverted, onOpenSource, onClose, expanded = false, onToggleExpanded, pendingPrompt, onPromptHandled
}: {
  note: Note | null;
  assets: Asset[];
  selection: string;
  cursorContext: string;
  onApply: (value: string, mode: ApplyMode) => void;
  onTagsChange: (tags: string[]) => Promise<void>;
  onAutoPublishChange: (enabled: boolean) => Promise<void>;
  onReverted: (note: Note) => void;
  onOpenSource: (assetId: string) => void;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  pendingPrompt?: { id: number; noteId: string; text: string } | null;
  onPromptHandled?: (id: number) => void;
}) {
  const { locale } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("ai");
  const [action, setAction] = useState<AssistantAction>("continue");
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [knowledgeSearch, setKnowledgeSearch] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<NoteLifecycle | null>(null);
  const [facts, setFacts] = useState<NoteFact[]>([]);
  const [error, setError] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [revertVersion, setRevertVersion] = useState<number | null>(null);
  const [correctTarget, setCorrectTarget] = useState<NoteFact | null>(null);
  const [forgetTarget, setForgetTarget] = useState<NoteFact | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const handledPromptRef = useRef<number | null>(null);

  const availableAssets = useMemo(() => assets.filter((asset) => asset.status === "ready" && asset.type !== "image"), [assets]);
  const output = [...messages].reverse().find((message) => message.role === "assistant")?.content || "";

  useEffect(() => {
    api.models().then((result) => {
      const configured = result.models.filter(
        (model) => model.configured && model.kind === "LLM",
      );
      setModels(configured);
      setModelId(
        (current) =>
          current ||
          configured.find(
            (model) => model.id === "llm_gpt_5_5" || model.name === "gpt-5.5",
          )?.id ||
          configured[0]?.id ||
          "",
      );
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    controllerRef.current?.abort();
    setMessages([]);
    setSelectedAssetIds([]);
    setLifecycle(null);
    setFacts([]);
    setError("");
  }, [note?.id]);

  useEffect(() => {
    if (!note || tab === "ai") return;
    if (tab === "gbrain") api.noteLifecycle(note.id).then(setLifecycle).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败"));
    if (tab === "facts") api.facts(note.workspace_id, undefined, note.id).then((result) => setFacts(result.facts)).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败"));
  }, [note, tab]);

  function updateAssistant(messageId: string, update: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => message.id === messageId ? update(message) : message));
  }

  async function runAssistant(override?: { action: AssistantAction; instruction: string }) {
    if (!note || loading) return;
    const nextAction = override?.action || action;
    const prompt = override?.instruction || instruction.trim() || `${actionLabels[nextAction]}当前${selection ? "选中内容" : "笔记"}`;
    const requestId = `${Date.now()}`;
    const assistantId = `${requestId}-assistant`;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setMessages((current) => [...current,
      { id: `${requestId}-user`, role: "user", content: prompt },
      { id: assistantId, role: "assistant", content: "", startedAt: Date.now(), sources: [] }
    ]);
    setInstruction("");
    setLoading(true);
    setError("");
    try {
      await api.streamNoteAssist(note.id, {
        action: nextAction,
        instruction: prompt,
        selection: selection || undefined,
        cursorContext: cursorContext || undefined,
        assetIds: selectedAssetIds,
        modelId: modelId || undefined,
        locale,
        options: { knowledgeSearch, webSearch }
      }, {
        source: (source) => updateAssistant(assistantId, (message) => ({
          ...message,
          sources: message.sources?.some((item) => item.assetId === source.assetId && item.heading === source.heading)
            ? message.sources
            : [...(message.sources || []), source]
        })),
        delta: (text) => updateAssistant(assistantId, (message) => ({ ...message, content: message.content + text })),
        done: (answer) => updateAssistant(assistantId, (message) => ({ ...message, content: message.content || answer }))
      }, controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) setError(formatAssistantError(reason, "AI 写作失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!note || !pendingPrompt || pendingPrompt.noteId !== note.id || loading || handledPromptRef.current === pendingPrompt.id) return;
    handledPromptRef.current = pendingPrompt.id;
    setTab("ai");
    void runAssistant({ action: "custom", instruction: pendingPrompt.text });
    onPromptHandled?.(pendingPrompt.id);
  }, [loading, note?.id, pendingPrompt?.id]);

  async function extractFacts() {
    if (!note) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.extractNoteFacts(note.id);
      setFacts(result.facts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "事实提取失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateFact(fact: NoteFact, operation: "verify" | "correct" | "forget", correction?: string) {
    setDialogBusy(true);
    try {
      const result = operation === "verify"
        ? await api.verifyFact(fact.id)
        : operation === "forget"
          ? await api.forgetFact(fact.id)
          : await api.correctFact(fact.id, correction || fact.corrected_fact || fact.fact);
      setFacts((current) => current.map((item) => item.id === fact.id ? result.fact : item));
      setCorrectTarget(null);
      setForgetTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setDialogBusy(false);
    }
  }

  async function revertToVersion(version: number) {
    if (!note) return;
    setDialogBusy(true);
    try {
      const result = await api.revertNote(note.id, version);
      onReverted(result.note);
      setLifecycle(await api.noteLifecycle(note.id));
      setRevertVersion(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本回滚失败");
    } finally {
      setDialogBusy(false);
    }
  }

  if (!note) return <aside className="note-inspector empty"><Sparkles size={30} /><strong>Mem-kb 写作助手</strong><span>选择笔记后，可调用当前 Workspace 的知识与长期事实。</span></aside>;

  return (
    <>
      <aside className={`note-inspector copilot-assistant ${expanded ? "expanded" : ""}`}>
        <header className="copilot-header">
          <span className="copilot-title"><Sparkles size={17} /><strong>AI 问答</strong></span>
          <span className="copilot-controls">
            <button onClick={() => { setMessages([]); setInstruction(""); }} title="新对话"><Plus size={16} /></button>
            <button className={historyOpen ? "active" : ""} onClick={() => setHistoryOpen((value) => !value)} title="对话历史"><History size={16} /></button>
            {onToggleExpanded ? <button onClick={onToggleExpanded} title={expanded ? "退出全屏" : "展开助手"}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button> : null}
            {onClose ? <button onClick={onClose} title="关闭助手"><X size={17} /></button> : null}
          </span>
        </header>
        <nav className="copilot-tabs" aria-label="助手视图">
          <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>对话</button>
          <button className={tab === "gbrain" ? "active" : ""} onClick={() => setTab("gbrain")}>知识</button>
          <button className={tab === "facts" ? "active" : ""} onClick={() => setTab("facts")}>Facts</button>
        </nav>
        {error ? <p className="inspector-error">{error}</p> : null}
        {historyOpen && tab === "ai" ? <div className="copilot-history"><strong>本次对话</strong><span>{messages.filter((message) => message.role === "user").length} 个问题</span><button onClick={() => { setMessages([]); setHistoryOpen(false); }}>清空历史</button></div> : null}
        {tab === "ai" ? (
          <div className="copilot-chat">
            <div className="copilot-thread" aria-live="polite">
              {!messages.length ? <div className="copilot-empty">
                <span className="copilot-wave" aria-hidden="true">👋</span>
                <strong>Hi，我可以帮你做什么</strong>
                <p>我会基于当前笔记回答、提炼和继续创作。</p>
                <div className="copilot-starter-questions">
                  {starterQuestions[locale].map((question) => <button type="button" key={question} onClick={() => void runAssistant({ action: "custom", instruction: question })}>{question}</button>)}
                </div>
              </div> : null}
              {messages.map((message) => message.role === "user" ? (
                <article key={message.id} className="copilot-message user"><p data-i18n-ignore>{message.content}</p></article>
              ) : (
                <article key={message.id} className="copilot-message assistant">
                  <span className="assistant-avatar"><Sparkles size={13} /></span>
                  <div>
                    {loading && message.id === messages[messages.length - 1]?.id ? <AssistantGenerationStatus startedAt={message.startedAt || Date.now()} compact={Boolean(message.content)} /> : null}
                    {message.content ? <MarkdownContent source={message.content} /> : loading ? null : <p>没有生成内容。</p>}
                    {message.sources?.length ? <section className="assistant-sources"><h3>引用资料</h3>{message.sources.map((source) => <button key={`${source.assetId}-${source.heading}`} onClick={() => onOpenSource(source.assetId)}><span><strong>{source.title}</strong><em>{source.heading || "相关内容"}</em></span><ExternalLink size={13} /></button>)}</section> : null}
                    {message.content ? <footer className="copilot-result-actions"><button onClick={() => onApply(message.content, "insert")}><ArrowDownToLine size={13} />插入光标处</button><button onClick={() => onApply(message.content, "append")}>追加到文末</button><button onClick={() => setReplaceOpen(true)}>{selection ? "替换选中内容" : "替换全文"}</button><button onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={13} />复制</button></footer> : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="copilot-composer-wrap">
              {resourcesOpen ? <div className="copilot-resources"><header><strong>指定资料</strong><span>{selectedAssetIds.length ? `已选 ${selectedAssetIds.length} 项` : "默认自动召回"}</span></header><div>{availableAssets.map((asset) => <label key={asset.id}><input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={(event) => setSelectedAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span>{asset.title}</span></label>)}</div></div> : null}
              <div className="copilot-composer">
                <div className="composer-note-context" title={`基于：${note.title}`}><FileText size={14} /><span>基于</span><strong data-i18n-ignore>{note.title}</strong></div>
                {selection ? <>
                  <span className="composer-context">已加入选中内容 · {selection.length} 字</span>
                  <div className="selection-quick-actions">
                    <button onClick={() => void runAssistant({ action: "custom", instruction: "解释选中内容，说明它的含义、逻辑和关键信息。" })}><Lightbulb />解释</button>
                    <button onClick={() => void runAssistant({ action: "rewrite", instruction: "优化选中内容，在不改变原意的前提下提升清晰度、结构和表达质量。" })}><WandSparkles />优化</button>
                  </div>
                </> : null}
                <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void runAssistant(); } }} placeholder="询问任何问题，或描述你想怎么修改…" />
                <div className="composer-toolbar">
                  <span className="composer-tools"><button className={resourcesOpen ? "active" : ""} onClick={() => setResourcesOpen((value) => !value)} title="添加资料"><Paperclip size={15} /></button><label><input type="checkbox" checked={knowledgeSearch} onChange={(event) => setKnowledgeSearch(event.target.checked)} />知识</label><label><input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />联网</label></span>
                  <span className="composer-send-group">
                    <label className="action-select"><select value={action} onChange={(event) => setAction(event.target.value as AssistantAction)}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={12} /></label>
                    {models.length ? <ModelPicker className="assistant-model-picker" ariaLabel="选择助手模型" models={models} value={modelId} onChange={setModelId} getMeta={assistantRole} /> : <span className="model-fallback">自动模型</span>}
                    <button className={`copilot-send ${loading ? "stop" : ""}`} aria-label={loading ? "停止生成" : "开始生成"} onClick={() => loading ? controllerRef.current?.abort() : void runAssistant()}>{loading ? <Square size={13} /> : <Send size={14} />}</button>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : tab === "gbrain" ? (
          <div className="inspector-scroll lifecycle-panel">
            <section><h3>发布策略</h3><label className="auto-publish-toggle"><input type="checkbox" checked={note.auto_publish} onChange={(event) => void onAutoPublishChange(event.target.checked)} /><span><strong>静置后自动发布</strong><em>草稿停止变化 45 秒后创建新版本并更新 GBrain。</em></span></label></section>
            <section><h3><Tag size={15} />标签</h3><div className="editable-tags">{note.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><button onClick={() => setTagsOpen(true)}>编辑标签</button></section>
            <section><h3><History size={15} />发布版本</h3>{(lifecycle?.revisions || []).map((revision) => <div className="lifecycle-row" key={revision.id}><span>v{revision.version} · {new Date(revision.created_at).toLocaleString(locale)}</span><button onClick={() => setRevertVersion(revision.version)}><RotateCcw size={12} />回滚</button></div>)}{!lifecycle?.revisions?.length ? <p>尚未发布，草稿不会进入 GBrain。</p> : null}</section>
            <section><h3><Clock3 size={15} />时间线</h3>{(lifecycle?.timeline || []).slice(0, 12).map((entry, index) => <div className="timeline-row" key={index}><i /><div><strong>{String(entry.summary || "内容更新")}</strong><span>{String(entry.date || entry.created_at || "")}</span></div></div>)}</section>
            <section><h3>反向链接</h3>{(lifecycle?.backlinks || []).map((item, index) => <div className="lifecycle-row" key={index}><span>{String(item.from_slug || item.from || item.slug || "关联页面")}</span><ExternalLink size={13} /></div>)}{!lifecycle?.backlinks?.length ? <p>暂无反向链接</p> : null}</section>
          </div>
        ) : (
          <div className="inspector-scroll facts-panel">
            <button className="button primary wide" onClick={() => void extractFacts()} disabled={loading}><Sparkles size={16} />从笔记提取事实</button>
            {facts.map((fact) => <article key={fact.id} className={`fact-card ${fact.status}`}><p>{fact.corrected_fact || fact.fact}</p><span>{fact.entity_slug || fact.kind} · {Math.round(fact.confidence * 100)}%</span><footer>{fact.status === "pending" ? <button onClick={() => void updateFact(fact, "verify")}><Check size={14} />确认</button> : null}<button onClick={() => setCorrectTarget(fact)}>纠正</button>{fact.status !== "forgotten" ? <button className="danger" onClick={() => setForgetTarget(fact)}><Trash2 size={14} />遗忘</button> : null}</footer></article>)}
            {!facts.length ? <p className="inspector-hint">提取后先由用户确认，只有已确认事实会进入问答和 AI 写作上下文。</p> : null}
          </div>
        )}
      </aside>
      <TextEntryDialog open={tagsOpen} title="编辑标签" description="使用逗号分隔，标签会参与知识筛选与检索。" label="标签" initialValue={note.tags.join(", ")} placeholder="例如：运营策略, SOP, 复盘" confirmText="保存标签" busy={dialogBusy} onCancel={() => setTagsOpen(false)} onConfirm={async (value) => { setDialogBusy(true); try { await onTagsChange(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)); setTagsOpen(false); } finally { setDialogBusy(false); } }} />
      <TextEntryDialog open={Boolean(correctTarget)} title="纠正事实" description="修正内容经确认后会进入后续问答和 AI 写作上下文。" label="事实内容" initialValue={correctTarget?.corrected_fact || correctTarget?.fact || ""} multiline confirmText="保存纠正" busy={dialogBusy} onCancel={() => setCorrectTarget(null)} onConfirm={(value) => correctTarget ? updateFact(correctTarget, "correct", value) : undefined} />
      <ConfirmActionDialog open={replaceOpen} danger title={selection ? "替换选中内容" : "替换笔记全文"} subject={note.title} description="替换只会修改当前草稿，发布前不会更新知识库与 GBrain。" confirmText="确认替换" onCancel={() => setReplaceOpen(false)} onConfirm={() => { onApply(output, "replace"); setReplaceOpen(false); }} />
      <ConfirmActionDialog open={revertVersion !== null} busy={dialogBusy} title="回滚笔记版本" subject={revertVersion === null ? undefined : `版本 ${revertVersion}`} description="当前内容会保留为历史版本，回滚结果将重新同步到 GBrain。" confirmText="确认回滚" onCancel={() => setRevertVersion(null)} onConfirm={() => revertVersion === null ? undefined : revertToVersion(revertVersion)} />
      <ConfirmActionDialog open={Boolean(forgetTarget)} danger busy={dialogBusy} title="遗忘长期事实" subject={forgetTarget?.corrected_fact || forgetTarget?.fact} description="该事实将不再参与后续问答和 AI 写作上下文。" confirmText="确认遗忘" onCancel={() => setForgetTarget(null)} onConfirm={() => forgetTarget ? updateFact(forgetTarget, "forget") : undefined} />
    </>
  );
}
