import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, BrainCircuit, Code, Columns2, Eye, Heading1, Heading2, Italic, List,
  ListOrdered, Maximize2, MessageCirclePlus, Minimize2, Network, PanelRightClose, PanelRightOpen, Quote, Redo2, Send, Strikethrough,
  UnderlineIcon, Undo2
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SaveIndicator } from "../../shared/LoadingSystem";
import type { Note } from "../../types/domain";
import { DocumentFindBar } from "./DocumentFindBar";
import { DocumentSearchExtension } from "./documentSearch";
import { NoteMindMap } from "./NoteMindMap";
import { placeSelectionAction, type Point } from "./selectionPosition";

export type EditorView = "document" | "mindmap" | "split" | "markdown";

interface SelectionContext {
  selection: string;
  cursorContext: string;
}

export function NoteEditor({
  note, title, markdown, contentJson, saveState, error, assistantOpen, focusMode,
  onTitleChange, onContentChange, onSelectionChange, onAddToChat, onPublish, onToggleAssistant, onToggleFocus,
  bindAssistantApply
}: {
  note: Note | null;
  title: string;
  markdown: string;
  contentJson: Record<string, unknown>;
  saveState: "idle" | "dirty" | "saving" | "saved" | "publishing";
  error: string;
  assistantOpen: boolean;
  focusMode: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (markdown: string, json: Record<string, unknown>) => void;
  onSelectionChange: (context: SelectionContext) => void;
  onAddToChat: () => void;
  onPublish: () => void;
  onToggleAssistant: () => void;
  onToggleFocus: () => void;
  bindAssistantApply: (apply: ((value: string, mode: "insert" | "replace" | "append") => void) | null) => void;
}) {
  const [view, setView] = useState<EditorView>("document");
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState<Point | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const applying = useRef(false);
  const selectionRange = useRef<{ from: number; to: number } | null>(null);
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
    applying.current = true;
    const json = contentJson?.type === "doc" ? contentJson : null;
    editor.commands.setContent(json || markdown, json ? undefined : { contentType: "markdown" });
    applying.current = false;
  }, [editor, note?.id]);

  useEffect(() => {
    if (!editor || applying.current || editor.getMarkdown() === markdown) return;
    applying.current = true;
    editor.commands.setContent(markdown, { contentType: "markdown" });
    applying.current = false;
  }, [editor, markdown]);

  useEffect(() => {
    if (!editor) return;
    bindAssistantApply((value, mode) => {
      if (mode === "replace" && !editor.state.selection.empty) editor.commands.insertContent(value, { contentType: "markdown" });
      else if (mode === "replace") editor.commands.setContent(value, { contentType: "markdown" });
      else if (mode === "append") editor.commands.insertContentAt(editor.state.doc.content.size, `\n\n${value}`, { contentType: "markdown" });
      else editor.commands.insertContent(value, { contentType: "markdown" });
      editor.commands.focus();
    });
    return () => bindAssistantApply(null);
  }, [bindAssistantApply, editor]);

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
          <Tool title={assistantOpen ? "关闭资料助手" : "打开资料助手"} active={assistantOpen} onClick={onToggleAssistant}>{assistantOpen ? <PanelRightClose /> : <PanelRightOpen />}</Tool>
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
            title={title}
          />
          <SaveIndicator state={saveState} published={published} error={error} />
        </div>
        <button className="button primary compact note-publish" onClick={onPublish} disabled={saveState === "saving" || saveState === "publishing" || !title.trim()}><Send size={15} />{saveState === "publishing" ? "发布中" : published ? "发布新版本" : "发布到知识库"}</button>
      </header>
      <div className={`note-content-view ${view}`}>
        {view === "document" || view === "split" ? <div className="note-editor-scroll">
          <EditorContent editor={editor} />
        </div> : null}
        {view === "mindmap" || view === "split" ? <NoteMindMap title={title} markdown={markdown} compact={view === "split"} /> : null}
        {view === "markdown" ? <textarea className="note-markdown-source" value={markdown} onChange={(event) => onContentChange(event.target.value, {})} aria-label="Markdown 原文" /> : null}
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

function Tool({ title, active = false, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick} title={title} aria-label={title} type="button"><i className="tool-glyph">{children}</i></button>;
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick} type="button" aria-label={label}><i className="view-glyph">{children}</i><span>{label}</span></button>;
}

function FileTextEmptyIcon() {
  return <BrainCircuit width="38" height="38" strokeWidth={1.5} />;
}
