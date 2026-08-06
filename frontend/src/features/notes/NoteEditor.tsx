import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowUp, Bold, BrainCircuit, Code, Columns2, Eye, Heading1, Heading2, Italic, List,
  ListOrdered, ListTree, Maximize2, MessageCirclePlus, Minimize2, Network, Pin, Quote, Redo2, Send, Strikethrough,
  UnderlineIcon, Undo2, WandSparkles
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveIndicator } from "../../shared/LoadingSystem";
import { AiOverviewPanel } from "../../shared/AiOverviewPanel";
import { api } from "../../api/client";
import type { Note, NoteOverview } from "../../types/domain";
import { DocumentFindBar } from "./DocumentFindBar";
import { DocumentSearchExtension } from "./documentSearch";
import { NoteMindMap } from "./NoteMindMap";
import { placeSelectionAction, type Point } from "./selectionPosition";
import { useI18n } from "../../i18n";
import { normalizeAssistantMarkdown } from "./markdownNormalize";

export type EditorView = "document" | "mindmap" | "split" | "markdown";

interface SelectionContext {
  selection: string;
  cursorContext: string;
}

export function NoteEditor({
  note, title, markdown, contentJson, saveState, error, focusMode,
  onTitleChange, onContentChange, onSelectionChange, onAddToChat, onAskAssistant, onPublish, onToggleFocus,
  bindAssistantApply
}: {
  note: Note | null;
  title: string;
  markdown: string;
  contentJson: Record<string, unknown>;
  saveState: "idle" | "dirty" | "saving" | "saved" | "publishing";
  error: string;
  focusMode: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (markdown: string, json: Record<string, unknown>) => void;
  onSelectionChange: (context: SelectionContext) => void;
  onAddToChat: () => void;
  onAskAssistant: (question: string) => void;
  onPublish: () => void;
  onToggleFocus: () => void;
  bindAssistantApply: (apply: ((value: string, mode: "insert" | "replace" | "append") => void) | null) => void;
}) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<EditorView>("document");
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState<Point | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");
  const [optimizeStatus, setOptimizeStatus] = useState("");
  const applying = useRef(false);
  const selectionRange = useRef<{ from: number; to: number } | null>(null);
  const optimizeAbort = useRef<AbortController | null>(null);
  const optimizeFrame = useRef<number | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Markdown,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "输入正文，或按 / 调用写作能力" }),
      DocumentSearchExtension
    ],
    content: "",
    onUpdate: ({ editor: current }) => {
      if (!applying.current) onContentChange(current.getMarkdown(), current.getJSON() as Record<string, unknown>);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      const selection = current.state.doc.textBetween(from, to, "\n");
      const active = Boolean(selection.trim());
      selectionRange.current = active ? { from, to } : null;
      setSelectionActive(active);
      if (!active) setSelectionPosition(null);
      const start = Math.max(0, from - 500);
      const end = Math.min(current.state.doc.content.size, to + 500);
      onSelectionChange({ selection, cursorContext: current.state.doc.textBetween(start, end, "\n") });
    }
  });

  const refreshSelectionPosition = useCallback(() => {
    if (!editor || !selectionRange.current || findOpen) return;
    const { from, to } = selectionRange.current;
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const visual = window.visualViewport;
      setSelectionPosition(placeSelectionAction(start, end, {
        width: visual?.width || window.innerWidth,
        height: visual?.height || window.innerHeight,
        offsetLeft: visual?.offsetLeft || 0,
        offsetTop: visual?.offsetTop || 0
      }));
    } catch {
      setSelectionPosition(null);
    }
  }, [editor, findOpen]);

  useEffect(() => {
    if (!selectionActive) return;
    refreshSelectionPosition();
    const refresh = () => window.requestAnimationFrame(refreshSelectionPosition);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
    };
  }, [refreshSelectionPosition, selectionActive]);

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setView("document");
      setFindOpen(true);
      setSelectionPosition(null);
    };
    window.addEventListener("keydown", handleFind);
    return () => window.removeEventListener("keydown", handleFind);
  }, []);

  useEffect(() => {
    if (!editor || !note) return;
    optimizeAbort.current?.abort();
    setOptimizing(false);
    setOptimizeStatus("");
    applying.current = true;
    const json = contentJson?.type === "doc" ? contentJson : null;
    editor.commands.setContent(json || normalizeAssistantMarkdown(markdown), json ? undefined : { contentType: "markdown" });
    applying.current = false;
  }, [editor, note?.id]);

  useEffect(() => () => {
    optimizeAbort.current?.abort();
    if (optimizeFrame.current !== null) window.cancelAnimationFrame(optimizeFrame.current);
  }, []);

  useEffect(() => {
    if (!editor || applying.current || editor.getMarkdown() === markdown) return;
    applying.current = true;
    editor.commands.setContent(normalizeAssistantMarkdown(markdown), { contentType: "markdown" });
    applying.current = false;
  }, [editor, markdown]);

  useEffect(() => {
    if (!editor) return;
    bindAssistantApply((value, mode) => {
      const normalized = normalizeAssistantMarkdown(value);
      if (mode === "replace" && !editor.state.selection.empty) editor.commands.insertContent(normalized, { contentType: "markdown" });
      else if (mode === "replace") editor.commands.setContent(normalized, { contentType: "markdown" });
      else if (mode === "append") editor.commands.insertContentAt(editor.state.doc.content.size, `\n\n${normalized}`, { contentType: "markdown" });
      else editor.commands.insertContent(normalized, { contentType: "markdown" });
      editor.commands.focus();
    });
    return () => bindAssistantApply(null);
  }, [bindAssistantApply, editor]);

  async function optimizeDocument() {
    if (!note || !editor || optimizing || !markdown.trim()) return;
    const source = editor.getMarkdown() || markdown;
    const controller = new AbortController();
    optimizeAbort.current?.abort();
    optimizeAbort.current = controller;
    let draft = "";
    let finalMarkdown = "";
    const flushDraft = (value: string) => {
      const normalized = normalizeAssistantMarkdown(value || source);
      applying.current = true;
      editor.commands.setContent(normalized, { contentType: "markdown" });
      applying.current = false;
    };
    const scheduleFlush = () => {
      if (optimizeFrame.current !== null) return;
      optimizeFrame.current = window.requestAnimationFrame(() => {
        optimizeFrame.current = null;
        if (draft.trim()) flushDraft(draft);
      });
    };
    setOptimizing(true);
    setOptimizeError("");
    setOptimizeStatus(t("准备优化"));
    try {
      await api.streamOptimizeNote(note.id, { title, content: source, locale }, {
        start: ({ total }) => setOptimizeStatus(total > 1 ? t("正在分段优化") : t("正在优化")),
        chunkStart: ({ index, total }) => setOptimizeStatus(total > 1 ? `${t("正在优化")} ${index + 1}/${total}` : t("正在优化")),
        delta: (text) => {
          draft += text;
          scheduleFlush();
        },
        chunkReset: ({ markdown: committed }) => {
          draft = committed;
          if (optimizeFrame.current !== null) {
            window.cancelAnimationFrame(optimizeFrame.current);
            optimizeFrame.current = null;
          }
          flushDraft(draft || source);
        },
        done: ({ markdown: optimized }) => { finalMarkdown = optimized; }
      }, controller.signal);
      if (optimizeFrame.current !== null) {
        window.cancelAnimationFrame(optimizeFrame.current);
        optimizeFrame.current = null;
      }
      const optimized = normalizeAssistantMarkdown(finalMarkdown || draft || source);
      flushDraft(optimized);
      onContentChange(editor.getMarkdown(), editor.getJSON() as Record<string, unknown>);
      editor.commands.focus("start");
    } catch (reason) {
      if (!controller.signal.aborted) setOptimizeError(friendlyOptimizeError(reason, t("优化文档失败"), t("优化未完成，已保留原文，请稍后重试")));
      applying.current = false;
    } finally {
      if (optimizeAbort.current === controller) optimizeAbort.current = null;
      if (!controller.signal.aborted) {
        setOptimizing(false);
        setOptimizeStatus("");
      }
    }
  }

  if (!note) return <section className="note-editor-empty"><FileTextEmptyIcon /><strong>选择或新建一篇笔记</strong><span>草稿自动保存，发布后才进入知识库和 GBrain。</span></section>;

  const command = (callback: () => void) => { callback(); editor?.commands.focus(); };
  const published = note.sync_status === "synced" && note.published_version > 0;
  return (
    <section className="note-editor-shell">
      <div className="note-commandbar">
        <div className="note-toolbar" aria-label="编辑工具栏">
          <Tool title="撤销" onClick={() => command(() => editor?.chain().focus().undo().run())}><Undo2 /></Tool>
          <Tool title="重做" onClick={() => command(() => editor?.chain().focus().redo().run())}><Redo2 /></Tool>
          <span />
          <Tool title="一级标题" onClick={() => command(() => editor?.chain().focus().toggleHeading({ level: 1 }).run())}><Heading1 /></Tool>
          <Tool title="二级标题" onClick={() => command(() => editor?.chain().focus().toggleHeading({ level: 2 }).run())}><Heading2 /></Tool>
          <Tool title="粗体" active={editor?.isActive("bold")} onClick={() => command(() => editor?.chain().focus().toggleBold().run())}><Bold /></Tool>
          <Tool title="斜体" active={editor?.isActive("italic")} onClick={() => command(() => editor?.chain().focus().toggleItalic().run())}><Italic /></Tool>
          <Tool title="下划线" active={editor?.isActive("underline")} onClick={() => command(() => editor?.chain().focus().toggleUnderline().run())}><UnderlineIcon /></Tool>
          <Tool title="删除线" active={editor?.isActive("strike")} onClick={() => command(() => editor?.chain().focus().toggleStrike().run())}><Strikethrough /></Tool>
          <span />
          <Tool title="无序列表" onClick={() => command(() => editor?.chain().focus().toggleBulletList().run())}><List /></Tool>
          <Tool title="有序列表" onClick={() => command(() => editor?.chain().focus().toggleOrderedList().run())}><ListOrdered /></Tool>
          <Tool title="引用" onClick={() => command(() => editor?.chain().focus().toggleBlockquote().run())}><Quote /></Tool>
          <Tool title="代码块" onClick={() => command(() => editor?.chain().focus().toggleCodeBlock().run())}><Code /></Tool>
        </div>
        <div className="note-view-actions">
          <div className="note-editor-tabs segmented-control" aria-label="笔记视图">
            <ViewButton active={view === "document"} label="文档" onClick={() => setView("document")}><Eye /></ViewButton>
            <ViewButton active={view === "mindmap"} label="导图" onClick={() => setView("mindmap")}><Network /></ViewButton>
            <ViewButton active={view === "split"} label="分屏" onClick={() => setView("split")}><Columns2 /></ViewButton>
            <ViewButton active={view === "markdown"} label="Markdown" onClick={() => setView("markdown")}><Code /></ViewButton>
          </div>
          <Tool title={focusMode ? "退出专注模式" : "进入专注模式"} active={focusMode} onClick={onToggleFocus}>{focusMode ? <Minimize2 /> : <Maximize2 />}</Tool>
        </div>
        <DocumentFindBar editor={editor} open={findOpen} onClose={() => setFindOpen(false)} />
      </div>
      <header className="note-editor-header">
        <div className="note-title-area">
          <input
            className="note-title-input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onBlur={(event) => { event.currentTarget.scrollLeft = 0; }}
            aria-label="笔记标题"
          />
          <div className="note-title-support">
            <SaveIndicator state={saveState} published={published} error={error} />
            <div className="note-document-meta">
              <span>{new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(note.updated_at))}</span>
              <span>{markdown.replace(/\s+/g, "").length} 字</span>
              {note.tags.slice(0, 3).map((tag) => <span className="note-meta-tag" key={tag} data-i18n-ignore>{tag}</span>)}
            </div>
            {optimizing && optimizeStatus ? <span className="note-editor-inline-status" role="status">{optimizeStatus}</span> : null}
            {optimizeError ? <span className="note-editor-inline-error" role="alert">{optimizeError}</span> : null}
          </div>
        </div>
        <div className="note-header-actions">
          <button className="button secondary compact note-optimize" onClick={() => void optimizeDocument()} disabled={optimizing || saveState === "saving" || saveState === "publishing" || !markdown.trim()} title={t("优化文档结构和内容")}><WandSparkles size={15} />{optimizing ? t("优化中") : t("优化全文")}</button>
          <button className="button primary compact note-publish" onClick={onPublish} disabled={saveState === "saving" || saveState === "publishing" || !title.trim()}><Send size={15} />{saveState === "publishing" ? "发布中" : published ? "发布新版本" : "发布到知识库"}</button>
        </div>
      </header>
      <div className={`note-content-view ${view}`}>
        {view === "document" || view === "split" ? <div className="note-editor-scroll">
          {view === "document" ? <NoteAiOverview note={note} title={title} markdown={markdown} locale={locale} onAskAssistant={onAskAssistant} /> : null}
          <EditorContent editor={editor} />
        </div> : null}
        {view === "mindmap" || view === "split" ? <NoteMindMap title={title} markdown={markdown} compact={view === "split"} /> : null}
        {view === "markdown" ? <textarea className="note-markdown-source" value={markdown} onChange={(event) => onContentChange(event.target.value, {})} aria-label="Markdown 原文" /> : null}
        {view === "document" ? <NoteReadingRail markdown={markdown} /> : null}
        {selectionActive && selectionPosition && !findOpen && (view === "document" || view === "split") ? <button
          className="selection-add-to-chat"
          style={{ left: selectionPosition.left, top: selectionPosition.top }}
          type="button"
          onMouseDown={(event) => { event.preventDefault(); onAddToChat(); }}
          onClick={(event) => { if (event.detail === 0) onAddToChat(); }}
        ><MessageCirclePlus size={14} />Add to chat</button> : null}
      </div>
    </section>
  );
}

const noteOverviewCache = new Map<string, NoteOverview>();

function NoteAiOverview({
  note, title, markdown, locale, onAskAssistant
}: {
  note: Note;
  title: string;
  markdown: string;
  locale: "zh-CN" | "en-US";
  onAskAssistant: (question: string) => void;
}) {
  const cacheKey = `${note.id}:${note.version}:${locale}`;
  const [overview, setOverview] = useState<NoteOverview | null>(() => noteOverviewCache.get(cacheKey) || null);
  const [busy, setBusy] = useState(!noteOverviewCache.has(cacheKey));
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => {
    let active = true;
    const cached = noteOverviewCache.get(cacheKey);
    if (cached) {
      setOverview(cached);
      setBusy(false);
      setOverviewError("");
      return () => { active = false; };
    }
    setOverview(null);
    setBusy(true);
    setOverviewError("");
    api.noteOverview(note.id, { title, content: markdown, locale }).then((result) => {
      if (!active) return;
      noteOverviewCache.set(cacheKey, result.overview);
      setOverview(result.overview);
    }).catch((reason) => {
      if (active) setOverviewError(reason instanceof Error ? reason.message : "AI 概览生成失败");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [note.id, locale]);

  async function regenerate() {
    setBusy(true);
    setOverviewError("");
    try {
      const result = await api.noteOverview(note.id, { title, content: markdown, locale });
      noteOverviewCache.set(cacheKey, result.overview);
      setOverview(result.overview);
    } catch (reason) {
      setOverviewError(reason instanceof Error ? reason.message : "AI 概览生成失败");
    } finally {
      setBusy(false);
    }
  }

  return <AiOverviewPanel
    subjectKey={`note:${note.id}`}
    summary={overview?.summary || ""}
    keyPoints={overview?.keyPoints || []}
    suggestedQuestions={overview?.suggestedQuestions || []}
    busy={busy}
    error={overviewError}
    defaultExpanded
    onRegenerate={regenerate}
    onAskQuestion={onAskAssistant}
  />;
}

function NoteReadingRail({ markdown }: { markdown: string }) {
  const headings = useMemo(() => extractOutline(markdown), [markdown]);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [progress, setProgress] = useState(0);
  const open = hovered || pinned;

  useEffect(() => {
    const scroll = document.querySelector<HTMLElement>(".note-content-view.document .note-editor-scroll");
    if (!scroll) return;
    const update = () => {
      const available = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      setProgress(Math.min(1, scroll.scrollTop / available));
    };
    update();
    scroll.addEventListener("scroll", update, { passive: true });
    return () => scroll.removeEventListener("scroll", update);
  }, [markdown]);

  function jumpTo(index: number) {
    const nodes = document.querySelectorAll<HTMLElement>(".note-content-view.document .tiptap h1, .note-content-view.document .tiptap h2, .note-content-view.document .tiptap h3");
    nodes[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function backToTop() {
    document.querySelector<HTMLElement>(".note-content-view.document .note-editor-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <aside
    className={`note-reading-rail ${open ? "open" : ""} ${pinned ? "pinned" : ""}`}
    aria-label="文章目录与阅读进度"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setHovered(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false); }}
  >
    <button type="button" className="note-outline-toggle" onClick={() => setPinned((value) => !value)} aria-expanded={open} aria-label={pinned ? "取消固定文章目录" : "固定文章目录"} title={pinned ? "取消固定文章目录" : "悬停查看文章目录，点击固定"}><ListTree /></button>
    <div className="note-progress-track" aria-label="阅读进度"><i style={{ height: `${Math.max(5, progress * 100)}%` }} /></div>
    {open ? <nav className="note-outline-panel">
      <header><strong>大纲</strong><button type="button" className={pinned ? "active" : ""} onClick={() => setPinned((value) => !value)} title={pinned ? "取消固定文章目录" : "固定文章目录"} aria-label={pinned ? "取消固定文章目录" : "固定文章目录"}><Pin /></button></header>
      {headings.length ? headings.map((heading, index) => <button type="button" key={`${heading.text}-${index}`} className={`level-${heading.level}`} onClick={() => jumpTo(index)} title={`跳转到：${heading.text}`} aria-label={`跳转到：${heading.text}`}><span data-i18n-ignore>{heading.text}</span></button>) : <span>暂无标题</span>}
    </nav> : null}
    {progress > .12 ? <button type="button" className="note-back-top" onClick={backToTop} title="回到顶部"><ArrowUp /></button> : null}
  </aside>;
}

function extractOutline(markdown: string) {
  return Array.from(markdown.matchAll(/^(#{1,3})\s+(.+)$/gm))
    .slice(0, 24)
    .map((match) => ({ level: match[1].length, text: match[2].replace(/[*_`\[\]]/g, "").trim() }));
}

function Tool({ title, active = false, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick} title={title} aria-label={title} type="button"><i className="tool-glyph">{children}</i></button>;
}

function friendlyOptimizeError(reason: unknown, fallback: string, timeoutFallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason || "");
  if (/模型返回为空|模型流式返回为空|response.*empty|timeout|aborted due to timeout/i.test(message)) {
    return timeoutFallback;
  }
  return message || fallback;
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button" aria-label={label}><i className="view-glyph">{children}</i><span>{label}</span></button>;
}

function FileTextEmptyIcon() {
  return <BrainCircuit width="38" height="38" strokeWidth={1.5} />;
}
