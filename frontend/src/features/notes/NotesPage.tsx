import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { ConfirmActionDialog, TextEntryDialog } from "../../shared/EntityDialogs";
import { useWorkspaces } from "../../shared/useWorkspaces";
import type { Asset, Note, NoteFolder } from "../../types/domain";
import { NoteEditor } from "./NoteEditor";
import { NoteInspector } from "./NoteInspector";
import { NoteNavigator, type NoteFilter } from "./NoteNavigator";
import { WorkspaceAssetInspector, WorkspaceAssetViewer } from "./WorkspaceAssetView";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePersistentBoolean } from "../../shared/usePersistentState";

type Selection = { kind: "note" | "asset"; id: string } | null;
const NOTES_NAVIGATOR_OPEN_KEY = "mem-kb:notes-navigator-open";

export function NotesPage() {
  const { workspaces, activeId, setActiveId } = useWorkspaces();
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [contentJson, setContentJson] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "publishing">("idle");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = usePersistentBoolean(NOTES_NAVIGATOR_OPEN_KEY, true);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [openingAsset, setOpeningAsset] = useState(false);
  const [selectionContext, setSelectionContext] = useState({ selection: "", cursorContext: "" });
  const [error, setError] = useState("");
  const [createDialog, setCreateDialog] = useState<"note" | "folder" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    setActiveAsset(null);
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
      restoreSelection(noteResult.notes, visibleAssets);
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

  function restoreSelection(nextNotes: Note[], nextAssets: Asset[]) {
    const selected = selection.current;
    if (selected?.kind === "note") {
      const note = nextNotes.find((item) => item.id === selected.id);
      if (note) {
        setActiveNote(note);
        activeNoteRef.current = note;
        setActiveAsset(null);
        return;
      }
    }
    if (selected?.kind === "asset") {
      const asset = nextAssets.find((item) => item.id === selected.id);
      if (asset) {
        setActiveAsset(asset);
        setActiveNote(null);
        activeNoteRef.current = null;
        return;
      }
    }

    const requestedSource = new URLSearchParams(window.location.search).get("source");
    const sourceNote = requestedSource ? nextNotes.find((note) => note.source_asset_id === requestedSource) : null;
    if (sourceNote) {
      activateNote(sourceNote);
      return;
    }

    const first = [
      ...nextNotes.map((note) => ({ kind: "note" as const, updatedAt: note.updated_at, value: note })),
      ...nextAssets.map((asset) => ({ kind: "asset" as const, updatedAt: asset.updated_at, value: asset }))
    ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (first?.kind === "note") activateNote(first.value);
    else if (first?.kind === "asset") activateAsset(first.value);
    else {
      selection.current = null;
      setActiveNote(null);
      activeNoteRef.current = null;
      setActiveAsset(null);
      clearDraft();
    }
  }

  function activateNote(note: Note) {
    selection.current = { kind: "note", id: note.id };
    setActiveAsset(null);
    setActiveNote(note);
    activeNoteRef.current = note;
    loadDraft(note);
  }

  function activateAsset(asset: Asset) {
    selection.current = { kind: "asset", id: asset.id };
    setActiveNote(null);
    activeNoteRef.current = null;
    setActiveAsset(asset);
    clearDraft();
  }

  async function selectNote(note: Note) {
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    activateNote(note);
  }

  async function selectAsset(asset: Asset) {
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    activateAsset(asset);
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

  async function openAssetInNotes() {
    if (!activeAsset || openingAsset) return;
    if (activeNoteRef.current && saveState === "dirty" && !await saveDraft()) return;
    setOpeningAsset(true);
    setError("");
    try {
      const result = await api.createNoteFromAsset(activeAsset.id);
      setNotes((current) => [result.note, ...current.filter((item) => item.id !== result.note.id)]);
      activateNote(result.note);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建工作副本失败");
    } finally {
      setOpeningAsset(false);
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
      setDeleteOpen(true);
    }
  }

  async function moveToTrash() {
    const note = activeNoteRef.current;
    if (!note) return;
    setDialogBusy(true);
    try {
      await api.deleteNote(note.id);
      const remaining = notes.filter((item) => item.id !== note.id);
      setNotes(remaining);
      selection.current = null;
      restoreSelection(remaining, assets);
      setDeleteOpen(false);
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
      restoreSelection(remaining, assets);
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

  const bindAssistantApply = useCallback((apply: typeof assistantApplyRef.current) => { assistantApplyRef.current = apply; }, []);
  const visibleAssets = filter === "all" ? filterAssets(assets, search) : [];

  return (
    <main className={`notes-page ${assistantOpen ? "assistant-open" : "assistant-closed"} ${assistantExpanded ? "assistant-expanded" : ""} ${activeAsset ? "asset-open" : ""} ${focusMode ? "focus-mode" : ""} ${navigatorOpen ? "" : "navigator-collapsed"}`}>
      <NoteNavigator
        workspaces={workspaces}
        workspaceId={activeId}
        folders={folders}
        notes={notes}
        assets={visibleAssets}
        activeNoteId={activeNote?.id || ""}
        activeAssetId={activeAsset?.id || ""}
        filter={filter}
        search={search}
        onWorkspaceChange={setActiveId}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onCreateFolder={() => setCreateDialog("folder")}
        onCreateNote={() => setCreateDialog("note")}
        onSelectNote={(note) => void selectNote(note)}
        onSelectAsset={(asset) => void selectAsset(asset)}
      />
      <button
        type="button"
        className="pane-collapse-toggle notes-navigator-toggle"
        onClick={() => setNavigatorOpen((current) => !current)}
        aria-label={navigatorOpen ? "收起笔记 Workspace" : "展开笔记 Workspace"}
        title={navigatorOpen ? "收起笔记 Workspace" : "展开笔记 Workspace"}
      >
        {navigatorOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
      </button>
      <section className={`note-workspace ${activeAsset ? "asset-selected" : ""}`}>
        {activeAsset ? <WorkspaceAssetViewer asset={activeAsset} opening={openingAsset} onOpenInNotes={() => void openAssetInNotes()} /> : <NoteEditor note={activeNote} title={title} markdown={markdown} contentJson={contentJson} saveState={saveState} error={error} assistantOpen={assistantOpen} focusMode={focusMode} onTitleChange={editTitle} onContentChange={editContent} onSelectionChange={setSelectionContext} onAddToChat={() => { setFocusMode(false); setAssistantOpen(true); }} onPublish={() => void publishCurrent()} onToggleAssistant={() => setAssistantOpen((value) => !value)} onToggleFocus={() => setFocusMode((value) => !value)} bindAssistantApply={bindAssistantApply} />}
        {activeNote ? <footer className="note-workspace-footer"><button onClick={() => void saveDraft({ favorite: !activeNote.is_favorite })} disabled={activeNote.status === "deleted"}>{activeNote.is_favorite ? "取消收藏" : "收藏笔记"}</button><button className={activeNote.status === "deleted" ? "" : "danger"} onClick={() => void deleteOrRestore()}>{activeNote.status === "deleted" ? "恢复笔记" : "移入回收站"}</button>{activeNote.status === "deleted" ? <button className="danger" onClick={() => setPurgeOpen(true)}>永久删除</button> : null}</footer> : null}
      </section>
      {activeAsset && !focusMode ? <WorkspaceAssetInspector asset={activeAsset} /> : assistantOpen && !focusMode ? <NoteInspector note={activeNote} assets={assets} selection={selectionContext.selection} cursorContext={selectionContext.cursorContext} onApply={applyAssistant} onTagsChange={async (tags) => { await saveDraft({ tags }); }} onAutoPublishChange={async (enabled) => { await saveDraft({ autoPublish: enabled }); }} onReverted={(note) => activateNote(note)} onOpenSource={(assetId) => { const asset = assets.find((item) => item.id === assetId); if (asset) activateAsset(asset); }} onClose={() => { setAssistantOpen(false); setAssistantExpanded(false); }} expanded={assistantExpanded} onToggleExpanded={() => setAssistantExpanded((value) => !value)} /> : null}
      <TextEntryDialog open={createDialog === "note"} title="新建笔记" description="笔记将创建在当前 Workspace，草稿自动保存，发布后才更新知识库。" label="笔记标题" initialValue="无标题笔记" placeholder="输入笔记标题" confirmText="创建笔记" busy={dialogBusy} onCancel={() => setCreateDialog(null)} onConfirm={createNote} />
      <TextEntryDialog open={createDialog === "folder"} title="新建目录" description="目录只整理当前 Workspace 中的笔记，不改变知识资产。" label="目录名称" placeholder="例如：活动复盘" confirmText="创建目录" busy={dialogBusy} onCancel={() => setCreateDialog(null)} onConfirm={createFolder} />
      <ConfirmActionDialog open={deleteOpen} danger busy={dialogBusy} title="移入回收站" subject={activeNote?.title} description="笔记将停止参与知识检索，可稍后在回收站恢复。" confirmText="移入回收站" onCancel={() => setDeleteOpen(false)} onConfirm={moveToTrash} />
      <ConfirmActionDialog open={purgeOpen} danger busy={dialogBusy} title="永久删除笔记" subject={activeNote?.title} description="正文、历史关联和长期事实将从 Mem-kb 中永久移除，此操作不可恢复。" confirmText="永久删除" onCancel={() => setPurgeOpen(false)} onConfirm={purgeFromTrash} />
    </main>
  );
}

function filterAssets(assets: Asset[], search: string) {
  const keyword = search.trim().toLocaleLowerCase();
  if (!keyword) return assets;
  return assets.filter((asset) => `${asset.title} ${asset.summary || ""}`.toLocaleLowerCase().includes(keyword));
}
