import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { ConfirmActionDialog, TextEntryDialog } from "../../shared/EntityDialogs";
import { useWorkspaces } from "../../shared/useWorkspaces";
import type { Asset, Note, NoteFolder } from "../../types/domain";
import { NoteEditor } from "./NoteEditor";
import { NoteInspector } from "./NoteInspector";
import { NoteNavigator, type NoteFilter } from "./NoteNavigator";
import { Sparkles } from "lucide-react";
import { useDockedPanel } from "../../shared/useDockedPanel";
import { TopbarPanelTrigger } from "../../shared/TopbarPanelTrigger";

type Selection = { kind: "note"; id: string } | null;
const NOTES_NAVIGATOR_PINNED_KEY = "mem-kb:notes-navigator-pinned-v2";

export function NotesPage() {
  const { workspaces, activeId, setActiveId } = useWorkspaces();
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [contentJson, setContentJson] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "publishing">("idle");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<{ id: number; noteId: string; text: string } | null>(null);
  const navigatorPanel = useDockedPanel(NOTES_NAVIGATOR_PINNED_KEY);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [openingAssetId, setOpeningAssetId] = useState("");
  const [selectionContext, setSelectionContext] = useState({ selection: "", cursorContext: "" });
  const [error, setError] = useState("");
  const [createDialog, setCreateDialog] = useState<"note" | "folder" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const editRevision = useRef(0);
  const selection = useRef<Selection>(null);
  const activeNoteRef = useRef<Note | null>(null);
  const assistantApplyRef = useRef<((value: string, mode: "insert" | "replace" | "append") => void) | null>(null);

  useEffect(() => { activeNoteRef.current = activeNote; }, [activeNote]);

  useEffect(() => {
    selection.current = null;
    setActiveNote(null);
    clearDraft();
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    let current = true;
    api.noteFolders(activeId)
      .then((result) => current && setFolders(result.folders))
      .catch(() => current && setFolders([]));
    return () => { current = false; };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    let current = true;
    const noteOptions = {
      folderId: !["all", "favorite", "trash"].includes(filter) ? filter : undefined,
      favorite: filter === "favorite",
      deleted: filter === "trash",
      search
    };
    setError("");
    Promise.all([
      api.notes(activeId, noteOptions),
      api.assets(activeId, "all")
    ]).then(([noteResult, assetResult]) => {
      if (!current) return;
      const visibleAssets = filter === "all" ? filterAssets(assetResult.assets, search) : [];
      setNotes(noteResult.notes);
      setAssets(assetResult.assets);
      restoreSelection(noteResult.notes);
    }).catch((reason) => {
      if (current) setError(reason instanceof Error ? reason.message : "Workspace 内容加载失败");
    });
    return () => { current = false; };
  }, [activeId, filter, search]);

  useEffect(() => {
    if (!activeNote || saveState !== "dirty") return;
    const timer = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(timer);
  }, [activeNote, title, markdown, saveState]);

  useEffect(() => {
    if (!activeNote?.auto_publish || activeNote.sync_status !== "pending" || saveState !== "saved") return;
    const timer = window.setTimeout(() => void publishCurrent(), 45_000);
    return () => window.clearTimeout(timer);
  }, [activeNote, saveState]);

  function restoreSelection(nextNotes: Note[]) {
    const selected = selection.current;
    if (selected?.kind === "note") {
      const note = nextNotes.find((item) => item.id === selected.id);
      if (note) {
        setActiveNote(note);
        activeNoteRef.current = note;
        return;
      }
    }

    const requestedSource = new URLSearchParams(window.location.search).get("source");
    const sourceNote = requestedSource ? nextNotes.find((note) => note.source_asset_id === requestedSource) : null;
    if (sourceNote) {
      activateNote(sourceNote);
      return;
    }

    const first = [...nextNotes].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
    if (first) activateNote(first);
    else {
      selection.current = null;
      setActiveNote(null);
      activeNoteRef.current = null;
      clearDraft();
    }
  }

  function activateNote(note: Note) {
    selection.current = { kind: "note", id: note.id };
    setActiveNote(note);
    activeNoteRef.current = note;
    loadDraft(note);
  }

  async function selectNote(note: Note) {
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    activateNote(note);
    navigatorPanel.closeTemporaryPanel();
  }

  async function selectAsset(asset: Asset) {
    navigatorPanel.closeTemporaryPanel();
    await openAssetInNotes(asset);
  }

  function loadDraft(note: Note) {
    setTitle(note.title);
    setMarkdown(note.content_markdown);
    setContentJson(note.content_json || {});
    setSaveState("saved");
    setError("");
  }

  function clearDraft() {
    setTitle("");
    setMarkdown("");
    setContentJson({});
    setSaveState("idle");
    setError("");
  }

  function editTitle(value: string) {
    editRevision.current += 1;
    setTitle(value);
    setSaveState("dirty");
  }

  function editContent(value: string, json: Record<string, unknown> = {}) {
    editRevision.current += 1;
    setMarkdown(value);
    setContentJson(json);
    setSaveState("dirty");
  }

  async function saveDraft(extra: { tags?: string[]; favorite?: boolean; autoPublish?: boolean } = {}) {
    const note = activeNoteRef.current;
    if (!note || saveState === "saving" || !title.trim()) return false;
    const revision = editRevision.current;
    setSaveState("saving");
    setError("");
    try {
      const result = await api.updateNote(note.id, { expectedVersion: note.version, title: title.trim(), content: markdown, contentJson, ...extra });
      activeNoteRef.current = result.note;
      if (selection.current?.kind === "note" && selection.current.id === result.note.id) setActiveNote(result.note);
      setNotes((current) => current.map((item) => item.id === result.note.id ? result.note : item));
      setSaveState(editRevision.current === revision ? "saved" : "dirty");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      setSaveState("idle");
      return false;
    }
  }

  async function publishCurrent() {
    if (saveState === "publishing") return;
    if (saveState === "dirty" && !await saveDraft()) return;
    const note = activeNoteRef.current;
    if (!note) return;
    setSaveState("publishing");
    setError("");
    try {
      const result = await api.publishNote(note.id);
      activeNoteRef.current = result.note;
      setActiveNote(result.note);
      setNotes((current) => current.map((item) => item.id === result.note.id ? result.note : item));
      setSaveState("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败");
      setSaveState("saved");
    }
  }

  async function openAssetInNotes(asset: Asset) {
    if (openingAssetId) return;
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    setOpeningAssetId(asset.id);
    setError("");
    try {
      const result = await api.createNoteFromAsset(asset.id);
      setNotes((current) => [result.note, ...current.filter((item) => item.id !== result.note.id)]);
      activateNote(result.note);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建工作副本失败");
    } finally {
      setOpeningAssetId("");
    }
  }

  async function createNote(nextTitle: string) {
    if (!activeId) return;
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    const folderId = !["all", "favorite", "trash"].includes(filter) ? filter : null;
    setDialogBusy(true);
    try {
      const result = await api.createNote({ workspaceId: activeId, folderId, title: nextTitle });
      setFilter(folderId || "all");
      setNotes((current) => [result.note, ...current]);
      activateNote(result.note);
      setCreateDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新建笔记失败");
    } finally {
      setDialogBusy(false);
    }
  }

  async function createFolder(name: string) {
    if (!activeId) return;
    setDialogBusy(true);
    try {
      const result = await api.createNoteFolder(activeId, name);
      setFolders((current) => [...current, result.folder]);
      setFilter(result.folder.id);
      setCreateDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新建目录失败");
    } finally {
      setDialogBusy(false);
    }
  }

  async function deleteOrRestore() {
    const note = activeNoteRef.current;
    if (!note) return;
    if (note.status === "deleted") {
      const result = await api.restoreNote(note.id);
      setFilter("all");
      activateNote(result.note);
    } else {
      setDeleteTarget(note);
    }
  }

  async function moveToTrash() {
    const note = deleteTarget;
    if (!note) return;
    setDialogBusy(true);
    try {
      await api.deleteNote(note.id);
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      if (activeNoteRef.current?.id === note.id) {
        selection.current = null;
        restoreSelection(remaining);
      }
      setDeleteTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移入回收站失败");
    } finally {
      setDialogBusy(false);
    }
  }

  async function purgeFromTrash() {
    const note = activeNoteRef.current;
    if (!note || note.status !== "deleted") return;
    setDialogBusy(true);
    try {
      await api.purgeNote(note.id);
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      selection.current = null;
      restoreSelection(remaining);
      setPurgeOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "永久删除失败");
    } finally {
      setDialogBusy(false);
    }
  }

  function applyAssistant(value: string, mode: "insert" | "replace" | "append") {
    if (assistantApplyRef.current) assistantApplyRef.current(value, mode);
    else editContent(mode === "append" ? `${markdown.trim()}\n\n${value}`.trim() : value);
  }

  function askAssistant(question: string) {
    const note = activeNoteRef.current;
    if (!note) return;
    setFocusMode(false);
    navigatorPanel.closeTemporaryPanel();
    setAssistantOpen(true);
    setAssistantPrompt({ id: Date.now(), noteId: note.id, text: question });
  }

  const bindAssistantApply = useCallback((apply: typeof assistantApplyRef.current) => { assistantApplyRef.current = apply; }, []);
  const visibleAssets = filter === "all" ? filterAssets(assets, search) : [];

  function toggleAssistant() {
    setAssistantOpen((current) => {
      if (!current) navigatorPanel.closeTemporaryPanel();
      return !current;
    });
  }

  return (
    <main className={`notes-page ${assistantOpen ? "assistant-open" : "assistant-closed"} ${assistantExpanded ? "assistant-expanded" : ""} ${focusMode ? "focus-mode" : ""} ${navigatorPanel.open ? "" : "navigator-collapsed"}`}>
      <NoteNavigator
        workspaces={workspaces}
        workspaceId={activeId}
        folders={folders}
        notes={notes}
        assets={visibleAssets}
        activeNoteId={activeNote?.id || ""}
        activeAssetId={openingAssetId}
        filter={filter}
        search={search}
        onWorkspaceChange={setActiveId}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onCreateFolder={() => setCreateDialog("folder")}
        onCreateNote={() => setCreateDialog("note")}
        pinned={navigatorPanel.pinned}
        onTogglePinned={navigatorPanel.togglePinned}
        onSelectNote={(note) => void selectNote(note)}
        onDeleteNote={setDeleteTarget}
        onSelectAsset={(asset) => void selectAsset(asset)}
      />
      {!focusMode ? <TopbarPanelTrigger label={navigatorPanel.open ? "收起笔记列表" : "展开笔记列表"} expanded={navigatorPanel.open} onToggle={navigatorPanel.open ? navigatorPanel.closePanel : navigatorPanel.openPanel} /> : null}
      <section className="note-workspace" onPointerDown={navigatorPanel.closeTemporaryPanel}>
        <NoteEditor note={activeNote} title={title} markdown={markdown} contentJson={contentJson} saveState={saveState} error={error} focusMode={focusMode} onTitleChange={editTitle} onContentChange={editContent} onSelectionChange={setSelectionContext} onAddToChat={() => { setFocusMode(false); navigatorPanel.closeTemporaryPanel(); setAssistantOpen(true); }} onAskAssistant={askAssistant} onPublish={() => void publishCurrent()} onToggleFocus={() => setFocusMode((value) => !value)} bindAssistantApply={bindAssistantApply} />
        {activeNote ? <footer className="note-workspace-footer"><button onClick={() => void saveDraft({ favorite: !activeNote.is_favorite })} disabled={activeNote.status === "deleted"}>{activeNote.is_favorite ? "取消收藏" : "收藏笔记"}</button><button className={activeNote.status === "deleted" ? "" : "danger"} onClick={() => void deleteOrRestore()}>{activeNote.status === "deleted" ? "恢复笔记" : "移入回收站"}</button>{activeNote.status === "deleted" ? <button className="danger" onClick={() => setPurgeOpen(true)}>永久删除</button> : null}</footer> : null}
      </section>
      {activeNote && !assistantOpen && !focusMode ? <button type="button" className="note-assistant-launcher" onClick={toggleAssistant} title="打开 AI 问答" aria-label="打开 AI 问答"><Sparkles /><span>AI</span></button> : null}
      {assistantOpen && !focusMode ? <NoteInspector note={activeNote} assets={assets} selection={selectionContext.selection} cursorContext={selectionContext.cursorContext} onApply={applyAssistant} onTagsChange={async (tags) => { await saveDraft({ tags }); }} onAutoPublishChange={async (enabled) => { await saveDraft({ autoPublish: enabled }); }} onReverted={(note) => activateNote(note)} onOpenSource={(assetId) => { const asset = assets.find((item) => item.id === assetId); if (asset) void selectAsset(asset); }} onClose={() => { setAssistantOpen(false); setAssistantExpanded(false); }} expanded={assistantExpanded} onToggleExpanded={() => setAssistantExpanded((value) => !value)} pendingPrompt={assistantPrompt} onPromptHandled={(id) => setAssistantPrompt((current) => current?.id === id ? null : current)} /> : null}
      <TextEntryDialog open={createDialog === "note"} title="新建笔记" description="笔记将创建在当前 Workspace，草稿自动保存，发布后才更新知识库。" label="笔记标题" initialValue="无标题笔记" placeholder="输入笔记标题" confirmText="创建笔记" busy={dialogBusy} onCancel={() => setCreateDialog(null)} onConfirm={createNote} />
      <TextEntryDialog open={createDialog === "folder"} title="新建目录" description="目录只整理当前 Workspace 中的笔记，不改变知识资产。" label="目录名称" placeholder="例如：活动复盘" confirmText="创建目录" busy={dialogBusy} onCancel={() => setCreateDialog(null)} onConfirm={createFolder} />
      <ConfirmActionDialog open={Boolean(deleteTarget)} danger busy={dialogBusy} title="移入回收站" subject={deleteTarget?.title} description="笔记将停止参与知识检索，可稍后在回收站恢复。" confirmText="移入回收站" onCancel={() => setDeleteTarget(null)} onConfirm={moveToTrash} />
      <ConfirmActionDialog open={purgeOpen} danger busy={dialogBusy} title="永久删除笔记" subject={activeNote?.title} description="正文、历史关联和长期事实将从 Mem-kb 中永久移除，此操作不可恢复。" confirmText="永久删除" onCancel={() => setPurgeOpen(false)} onConfirm={purgeFromTrash} />
    </main>
  );
}

function filterAssets(assets: Asset[], search: string) {
  const keyword = search.trim().toLocaleLowerCase();
  if (!keyword) return assets;
  return assets.filter((asset) => `${asset.title} ${asset.summary || ""}`.toLocaleLowerCase().includes(keyword));
}
