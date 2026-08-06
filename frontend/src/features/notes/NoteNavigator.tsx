import { FileText, Folder, FolderPlus, Plus, Search, Star, Trash2 } from "lucide-react";
import type { Asset, Note, NoteFolder, Workspace } from "../../types/domain";
import { FileTypeIcon, resolveFileFormat } from "../knowledge/FileTypeIcon";

export type NoteFilter = "all" | "favorite" | "trash" | string;

type ContentEntry =
  | { kind: "note"; id: string; updatedAt: string; note: Note }
  | { kind: "asset"; id: string; updatedAt: string; asset: Asset };

interface NoteNavigatorProps {
  workspaces: Workspace[];
  workspaceId: string;
  folders: NoteFolder[];
  notes: Note[];
  assets: Asset[];
  activeNoteId: string;
  activeAssetId: string;
  filter: NoteFilter;
  search: string;
  onWorkspaceChange: (id: string) => void;
  onFilterChange: (filter: NoteFilter) => void;
  onSearchChange: (value: string) => void;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onSelectNote: (note: Note) => void;
  onSelectAsset: (asset: Asset) => void;
}

export function NoteNavigator({ workspaces, workspaceId, folders, notes, assets, activeNoteId, activeAssetId, filter, search, onWorkspaceChange, onFilterChange, onSearchChange, onCreateFolder, onCreateNote, onSelectNote, onSelectAsset }: NoteNavigatorProps) {
  const entries: ContentEntry[] = [
    ...notes.map((note) => ({ kind: "note" as const, id: note.id, updatedAt: note.updated_at, note })),
    ...assets.map((asset) => ({ kind: "asset" as const, id: asset.id, updatedAt: asset.updated_at, asset }))
  ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  return (
    <aside className="note-navigator">
      <header>
        <div><span>笔记空间</span><strong>Workspace 内容</strong></div>
        <button className="icon-button" onClick={onCreateNote} title="新建笔记"><Plus size={18} /></button>
      </header>
      <select value={workspaceId} onChange={(event) => onWorkspaceChange(event.target.value)} aria-label="选择 Workspace">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      <nav className="note-filters">
        <button className={filter === "all" ? "active" : ""} onClick={() => onFilterChange("all")}><FileText size={16} />全部内容</button>
        <button className={filter === "favorite" ? "active" : ""} onClick={() => onFilterChange("favorite")}><Star size={16} />收藏笔记</button>
        <button className={filter === "trash" ? "active" : ""} onClick={() => onFilterChange("trash")}><Trash2 size={16} />回收站</button>
      </nav>
      <div className="note-folder-heading"><span>笔记目录</span><button onClick={onCreateFolder} title="新建目录"><FolderPlus size={16} /></button></div>
      <div className="note-folders">
        {folders.map((folder) => <button key={folder.id} className={filter === folder.id ? "active" : ""} onClick={() => onFilterChange(folder.id)}><Folder size={16} /><span>{folder.name}</span></button>)}
        {!folders.length ? <p>暂无目录</p> : null}
      </div>
      <label className="note-search"><Search size={15} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索当前 Workspace" /></label>
      <div className="note-list">
        {entries.map((entry) => entry.kind === "note" ? (
          <button key={`note-${entry.id}`} className={entry.id === activeNoteId ? "active" : ""} onClick={() => onSelectNote(entry.note)}>
            <span><FileTypeIcon format="md" compact /><strong>{entry.note.title}</strong>{entry.note.is_favorite ? <Star size={12} fill="currentColor" /> : null}</span>
            <em>笔记 · {excerpt(entry.note.content_markdown, "空白笔记")}</em>
          </button>
        ) : (
          <button key={`asset-${entry.id}`} className={entry.id === activeAssetId ? "active" : ""} onClick={() => onSelectAsset(entry.asset)}>
            <span><FileTypeIcon format={entry.asset.format} title={entry.asset.title} compact /><strong>{entry.asset.title}</strong><i className={`content-status ${entry.asset.status}`}>{statusLabel(entry.asset.status)}</i></span>
            <em>{resolveFileFormat(entry.asset.format, entry.asset.title).toUpperCase()} · {excerpt(entry.asset.summary || "", "知识资产")}</em>
          </button>
        ))}
        {!entries.length ? <p className="note-list-empty">当前 Workspace 暂无内容</p> : null}
      </div>
    </aside>
  );
}

function excerpt(value: string, fallback: string) {
  return value.replace(/[#*_>`\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 46) || fallback;
}

function statusLabel(status: Asset["status"]) {
  return { queued: "排队中", indexing: "解析中", ready: "可检索", failed: "失败", deleted: "已删除" }[status];
}
