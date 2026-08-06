import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, ChevronDown, History, MessageSquareText, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import { useWorkspaces } from "../../shared/useWorkspaces";
import type { Asset, Conversation, ConversationMessage, InsightItem, ModelInfo } from "../../types/domain";
import { CaptureDialog } from "./CaptureDialog";
import { ChatComposer, type QaOptions } from "./ChatComposer";
import { ConversationHistory } from "./ConversationHistory";
import { MessageThread } from "./MessageThread";
import { FileTypeIcon } from "../knowledge/FileTypeIcon";
import productLogo from "../../assets/icons/product_logo.png";
import productLogoVideo from "../../assets/icons/product_logo.mp4";
import { useDockedPanel } from "../../shared/useDockedPanel";
import { TopbarPanelTrigger } from "../../shared/TopbarPanelTrigger";
import { formatAssistantError } from "../../shared/AssistantExperience";

const QA_HISTORY_PINNED_KEY = "mem-kb:qa-history-pinned-v2";

export function KnowledgeQaPage() {
  const { workspaces, active, activeId, setActiveId, loading: workspaceLoading } = useWorkspaces();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("新会话");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyPanel = useDockedPanel(QA_HISTORY_PINNED_KEY);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [captureTarget, setCaptureTarget] = useState<ConversationMessage | null>(null);
  const [attachment, setAttachment] = useState<Pick<Asset, "id" | "title" | "workspace_id"> | null>(null);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [insights, setInsights] = useState<{ questions: InsightItem[]; documents: InsightItem[] }>({ questions: [], documents: [] });
  const [options, setOptions] = useState<QaOptions>({ documentQa: true, webSearch: false, imageSearch: false });
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.models().then(({ models: items }) => {
      const available = items.filter((item) => item.kind === "LLM" && item.configured);
      setModels(available);
      setModelId((current) => current || available.find((item) => item.name === "gpt-5.5")?.id || available[0]?.id || "");
    }).catch(() => setModels([]));
    void refreshConversations();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setWorkspaceIds((current) => current.length ? current : [activeId]);
    setSuggestionOffset(0);
    api.insights(activeId).then(setInsights).catch(() => setInsights({ questions: [], documents: [] }));
  }, [activeId]);

  useEffect(() => {
    if (!messages.length) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth", block: "end" }));
  }, [messages, loading]);

  async function refreshConversations() {
    setHistoryLoading(true);
    try {
      const result = await api.conversations();
      setConversations(result.conversations);
    } catch {
      setConversations([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function replaceMessage(id: string, update: (message: ConversationMessage) => ConversationMessage) {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  }

  async function ask(nextQuestion = question, branch = false) {
    const content = nextQuestion.trim();
    if (!active || !content || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    const stamp = Date.now();
    const userId = `local-user-${stamp}`;
    const assistantId = `local-assistant-${stamp}`;
    abortRef.current = controller;
    setLoading(true);
    setPageError("");
    setQuestion("");
    const scopedAttachment = attachment;
    setAttachment(null);
    setConversationTitle((current) => current === "新会话" || branch ? content.slice(0, 40) : current);
    setMessages((current) => [...current,
      { id: userId, conversation_id: conversationId, role: "user", content, model_id: null, created_at: new Date().toISOString(), citations: [], status: "complete" },
      { id: assistantId, conversation_id: conversationId, role: "assistant", content: "", model_id: modelId, created_at: new Date().toISOString(), citations: [], status: "streaming" }
    ]);
    if (branch) setConversationId("");
    try {
      await api.streamAsk({
        workspaceId: active.id,
        workspaceIds: workspaceIds.length ? workspaceIds : [active.id],
        assetIds: scopedAttachment ? [scopedAttachment.id] : undefined,
        question: content,
        modelId,
        conversationId: branch ? undefined : conversationId || undefined,
        options
      }, {
        meta: (data) => {
          setConversationId(data.conversationId);
          replaceMessage(userId, (message) => ({ ...message, id: data.userMessageId, conversation_id: data.conversationId }));
          replaceMessage(assistantId, (message) => ({ ...message, conversation_id: data.conversationId }));
        },
        citation: (citation) => replaceMessage(assistantId, (message) => ({ ...message, citations: [...message.citations, citation] })),
        delta: ({ text }) => replaceMessage(assistantId, (message) => ({ ...message, content: message.content + text })),
        done: ({ assistantMessage, answer }) => replaceMessage(assistantId, (message) => ({ ...message, ...assistantMessage, content: answer, status: "complete" }))
      }, controller.signal);
      await refreshConversations();
      api.insights(active.id).then(setInsights).catch(() => undefined);
    } catch (reason) {
      if (controller.signal.aborted) {
        replaceMessage(assistantId, (message) => ({ ...message, status: "stopped" }));
      } else {
        const message = formatAssistantError(reason, "问答失败");
        replaceMessage(assistantId, (current) => ({ ...current, status: "error", error: message }));
        setPageError(message);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    setConversationId("");
    setConversationTitle("新会话");
    setMessages([]);
    setQuestion("");
    setAttachment(null);
    setPageError("");
    setHistoryOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function loadConversation(conversation: Conversation) {
    abortRef.current?.abort();
    setHistoryLoading(true);
    setPageError("");
    try {
      const result = await api.conversation(conversation.id);
      setConversationId(result.conversation.id);
      setConversationTitle(result.conversation.title);
      setActiveId(result.conversation.workspace_id);
      setWorkspaceIds(result.conversation.workspace_ids?.length ? result.conversation.workspace_ids : [result.conversation.workspace_id]);
      setModelId(result.conversation.model_id);
      setMessages(result.messages.map((message) => ({ ...message, status: "complete" })));
      setHistoryOpen(false);
      setQuestion("");
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "会话加载失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteConversation(conversation: Conversation) {
    setHistoryLoading(true);
    setPageError("");
    try {
      await api.deleteConversation(conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (conversation.id === conversationId) {
        if (remaining[0]) await loadConversation(remaining[0]);
        else newConversation();
      }
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "会话删除失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  function fillQuestion(value: string) {
    setQuestion(value);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(value.length, value.length);
    });
  }

  function openHistoryPanel() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setHistoryOpen(true);
      void refreshConversations();
      return;
    }
    historyPanel.openPanel();
  }

  function branchFrom(index: number) {
    const source = [...messages.slice(0, index)].reverse().find((message) => message.role === "user");
    if (!source) return;
    newConversation();
    void ask(source.content, true);
  }

  function retryFrom(index: number) {
    const source = [...messages.slice(0, index)].reverse().find((message) => message.role === "user");
    if (source) void ask(source.content);
  }

  async function uploadAttachment(file: File) {
    if (!active || active.kind === "image") {
      setPageError("请切换到文档知识库后上传附件");
      return;
    }
    setUploading(true);
    setPageError("");
    try {
      const result = await api.upload(active.id, file);
      setAttachment({ id: result.asset.id, title: result.asset.title, workspace_id: result.asset.workspace_id });
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "附件上传失败");
    } finally {
      setUploading(false);
    }
  }

  function changeWorkspaceScope(ids: string[]) {
    const availableIds = new Set(workspaces.map((workspace) => workspace.id));
    const next = [...new Set(ids.filter((id) => availableIds.has(id)))];
    if (!next.length && activeId) next.push(activeId);
    if (!next.includes(activeId) && next[0]) {
      if (messages.length) newConversation();
      setActiveId(next[0]);
    }
    setWorkspaceIds(next);
  }

  const suggestionPool = [...new Set([
    ...insights.questions.map((item) => item.question || "").filter(isUsefulSuggestion),
    "如何沉淀一套可复用的运营 SOP？",
    "总结当前知识库的核心运营策略。",
    "哪些资料可以整理成新人培训文档？",
    "找出当前引用最多的运营资料。",
    "将现有经验整理成可执行的标准流程。",
    "分析知识库中仍然缺失的关键内容。",
    "提炼适合团队复用的策略与注意事项。",
    "根据现有资料生成一份阶段复盘。"
  ])];
  const visibleSuggestions = Array.from(
    { length: Math.min(4, suggestionPool.length) },
    (_, index) => suggestionPool[(suggestionOffset + index) % suggestionPool.length]
  );
  const hasConversation = messages.length > 0;
  const composer = (
    <ChatComposer
      value={question}
      inputRef={composerRef}
      models={models}
      modelId={modelId}
      workspaces={workspaces}
      workspaceId={activeId}
      workspaceIds={workspaceIds}
      options={options}
      loading={loading}
      uploading={uploading}
      disabled={!question.trim() || workspaceLoading || !modelId}
      compact={hasConversation}
      attachment={attachment?.title}
      onChange={setQuestion}
      onModelChange={setModelId}
      onWorkspaceScopeChange={changeWorkspaceScope}
      onOptionsChange={setOptions}
      onSubmit={() => void ask()}
      onStop={() => abortRef.current?.abort()}
      onUpload={(file) => void uploadAttachment(file)}
      onClearAttachment={() => setAttachment(null)}
    />
  );

  return (
    <div className={`qa-module-layout ${historyPanel.open ? "" : "history-collapsed"}`}>
      <ConversationHistory embedded open={historyPanel.open} pinned={historyPanel.pinned} loading={historyLoading} conversations={conversations} workspaces={workspaces} activeId={conversationId} onClose={() => undefined} onTogglePinned={historyPanel.togglePinned} onNew={newConversation} onSelect={(conversation) => void loadConversation(conversation)} onDelete={(conversation) => void deleteConversation(conversation)} />
      <TopbarPanelTrigger label={historyPanel.open ? "收起问答历史" : "展开问答历史"} expanded={historyPanel.open} onToggle={historyPanel.open ? historyPanel.closePanel : openHistoryPanel} />
      <main className={`qa-chat-page ${hasConversation ? "conversation-mode" : "welcome-mode"}`} onPointerDown={historyPanel.closeTemporaryPanel}>
      <header className="qa-chat-toolbar">
        <div><strong>{conversationTitle}</strong>{hasConversation ? <span>{active?.name || "知识库"}</span> : null}</div>
        <nav className="qa-mobile-actions"><button onClick={() => { setHistoryOpen(true); void refreshConversations(); }}><History size={17} />历史</button><button onClick={newConversation}><Plus size={17} />新建会话</button></nav>
      </header>

      {hasConversation ? (
        <>
          <section className="conversation-scroll">
            <MessageThread
              messages={messages}
              modelName={(id) => models.find((model) => model.id === id)?.name || id || "AI"
              }
              workspaceName={active?.name || "知识库"}
              onFeedback={(id, value) => void api.feedback(id, value)}
              onBranch={branchFrom}
              onCapture={setCaptureTarget}
              onRetry={retryFrom}
            />
            <div ref={endRef} />
          </section>
          <button className="jump-latest" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })} title="回到底部"><ChevronDown size={18} /></button>
          <footer className="composer-dock">{composer}<p>AI 回答仅供参考，重要内容请核对来源。</p></footer>
        </>
      ) : (
        <section className="qa-welcome-scroll">
          <div className="qa-welcome">
            <header className="qa-welcome-heading">
              <span><MessageSquareText size={15} />MEM-KB · 来源可追溯</span>
              <div className="qa-welcome-title">
                <SeamlessBrandVideo />
                <h1>从知识中获得答案</h1>
              </div>
              <p>检索企业知识、图片素材与公开网页，并保留可核验的来源。</p>
            </header>
            {composer}
            <section className="welcome-showcase">
              <header className="welcome-suggestion-heading">
                <div><Sparkles size={16} /><span><h2>猜你想问</h2><p>基于当前知识库与真实使用频率推荐。</p></span></div>
                <button onClick={() => setSuggestionOffset((current) => (current + 4) % suggestionPool.length)}><RefreshCw size={14} />换一换</button>
              </header>
              <div className="welcome-question-grid">{visibleSuggestions.map((item) => <button key={item} onClick={() => fillQuestion(item)}><MessageSquareText size={16} /><span>{item}</span><ArrowUpRight size={15} /></button>)}</div>
              <div className="welcome-knowledge-row">
                <header><BookOpen size={16} /><strong>常用知识</strong><span>{insights.documents.length} 项</span></header>
                <div className="welcome-documents">{insights.documents.length ? insights.documents.slice(0, 4).map((item) => <a key={item.asset_id} href={`/knowledge/documents?asset=${encodeURIComponent(item.asset_id || "")}`}><FileTypeIcon title={item.title} compact /><span>{item.title}</span><b>{item.count}</b></a>) : <div className="welcome-documents-empty"><span>问答产生引用后，常用资料会显示在这里。</span><a href="/knowledge/documents">添加知识资料<ArrowUpRight size={14} /></a></div>}</div>
              </div>
            </section>
          </div>
        </section>
      )}

      {pageError ? <div className="qa-toast" role="alert"><span>{pageError}</span><button onClick={() => setPageError("")}>关闭</button></div> : null}
      <ConversationHistory open={historyOpen} loading={historyLoading} conversations={conversations} workspaces={workspaces} activeId={conversationId} onClose={() => setHistoryOpen(false)} onNew={newConversation} onSelect={(conversation) => void loadConversation(conversation)} onDelete={(conversation) => void deleteConversation(conversation)} />
      {captureTarget ? <CaptureDialog workspaces={workspaces} defaultWorkspaceId={activeId} messageId={captureTarget.id} content={captureTarget.content} onClose={() => setCaptureTarget(null)} /> : null}
      </main>
    </div>
  );
}

function SeamlessBrandVideo() {
  const primaryRef = useRef<HTMLVideoElement>(null);
  const secondaryRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<0 | 1>(0);
  const switchingRef = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);
  const [visibleIndex, setVisibleIndex] = useState<0 | 1>(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const videos = [primaryRef.current, secondaryRef.current];
    if (!videos[0] || !videos[1]) return;

    let animationFrame = 0;
    const tick = () => {
      const current = videos[activeRef.current];
      if (current && current.duration && !switchingRef.current && current.duration - current.currentTime <= 0.36) {
        const nextIndex = activeRef.current === 0 ? 1 : 0;
        const next = videos[nextIndex];
        if (next) {
          switchingRef.current = true;
          next.currentTime = 0;
          void next.play().then(() => {
            setVisibleIndex(nextIndex);
            transitionTimerRef.current = window.setTimeout(() => {
              current.pause();
              current.currentTime = 0;
              activeRef.current = nextIndex;
              switchingRef.current = false;
            }, 280);
          }).catch(() => { switchingRef.current = false; });
        }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    void videos[0].play().catch(() => undefined);
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      videos.forEach((video) => video?.pause());
    };
  }, []);

  return (
    <span className="qa-welcome-brand" aria-hidden="true">
      {[primaryRef, secondaryRef].map((ref, index) => (
        <video
          ref={ref}
          className={visibleIndex === index ? "is-visible" : ""}
          key={index}
          loop
          muted
          playsInline
          preload="auto"
          poster={productLogo}
          tabIndex={-1}
          disablePictureInPicture
        >
          <source src={productLogoVideo} type="video/mp4" />
        </video>
      ))}
      <img src={productLogo} alt="" />
    </span>
  );
}

function isUsefulSuggestion(value: string) {
  const question = value.trim();
  return question.length >= 8
    && question.length <= 60
    && !/^https?:\/\//i.test(question)
    && !/^(还有呢|继续|你好|只回答|收到)/.test(question);
}
