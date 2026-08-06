import { FileText, Folder, FolderPlus, Pin, Plus, Search, Star, Trash2 } from "lucide-react";
import type { Asset, Note, NoteFolder, Workspace } from "../../types/domain";
import { FileTypeIcon, resolveFileFormat } from "../knowledge/FileTypeIcon";
import { useI18n, type AppLocale } from "../../i18n";

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
  pinned: boolean;
  onTogglePinned: () => void;
  onSelectNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onSelectAsset: (asset: Asset) => void;
}

export function NoteNavigator({ workspaces, workspaceId, folders, notes, assets, activeNoteId, activeAssetId, filter, search, onWorkspaceChange, onFilterChange, onSearchChange, onCreateFolder, onCreateNote, pinned, onTogglePinned, onSelectNote, onDeleteNote, onSelectAsset }: NoteNavigatorProps) {
  const { locale } = useI18n();
  const entries: ContentEntry[] = [
    ...notes.map((note) => ({ kind: "note" as const, id: note.id, updatedAt: note.updated_at, note })),
    ...assets.map((asset) => ({ kind: "asset" as const, id: asset.id, updatedAt: asset.updated_at, asset }))
  ].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const groupedEntries = groupEntries(entries);

  return (
    <aside className="note-navigator">
      <header>
        <div><span>笔记空间</span><strong>Workspace 内容</strong></div>
        <span className="panel-header-actions">
          <button className={`icon-button panel-pin-button ${pinned ? "active" : ""}`} onClick={onTogglePinned} title={pinned ? "取消固定笔记列表" : "固定笔记列表"} aria-pressed={pinned}><Pin size={15} fill={pinned ? "currentColor" : "none"} /></button>
          <button className="icon-button note-create-button" onClick={onCreateNote} title="新建笔记"><Plus size={18} /></button>
        </span>
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
        {groupedEntries.map((group) => <section className="note-date-section" key={group.label}>
          <h3>{group.label}</h3>
          {group.items.map((entry) => entry.kind === "note" ? <NoteEntry
            key={`note-${entry.id}`}
            note={entry.note}
            active={entry.id === activeNoteId}
            time={formatEntryTime(entry.updatedAt, locale)}
            onSelect={onSelectNote}
            onDelete={onDeleteNote}
          /> : <AssetEntry
            key={`asset-${entry.id}`}
            asset={entry.asset}
            active={entry.id === activeAssetId}
            time={formatEntryTime(entry.updatedAt, locale)}
            onSelect={onSelectAsset}
          />)}
        </section>)}
        {!entries.length ? <p className="note-list-empty">当前 Workspace 暂无内容</p> : null}
      </div>
    </aside>
  );
}

function NoteEntry({ note, active, time, onSelect, onDelete }: { note: Note; active: boolean; time: string; onSelect: (note: Note) => void; onDelete: (note: Note) => void }) {
  return <article className={`note-entry ${active ? "active" : ""}`}>
    <button className="note-entry-main" type="button" onClick={() => onSelect(note)}>
      <span><FileTypeIcon format="md" compact /><strong>{note.title}</strong>{note.is_favorite ? <Star size={12} fill="currentColor" /> : null}</span>
      <span className="note-entry-meta"><em>笔记 · {excerpt(note.content_markdown, "空白笔记")}</em><time>{time}</time></span>
    </button>
    {note.status !== "deleted" ? <button className="note-entry-delete" type="button" title="移入回收站" aria-label={`移入回收站：${note.title}`} onClick={() => onDelete(note)}><Trash2 size={14} /></button> : null}
  </article>;
}

function AssetEntry({ asset, active, time, onSelect }: { asset: Asset; active: boolean; time: string; onSelect: (asset: Asset) => void }) {
  return <article className={`note-entry ${active ? "active" : ""}`}>
    <button className="note-entry-main" type="button" onClick={() => onSelect(asset)}>
      <span><FileTypeIcon format={asset.format} title={asset.title} compact /><strong>{asset.title}</strong><i className={`content-status ${asset.status}`}>{statusLabel(asset.status)}</i></span>
      <span className="note-entry-meta"><em>{resolveFileFormat(asset.format, asset.title).toUpperCase()} · {excerpt(asset.summary || "", "知识资产")}</em><time>{time}</time></span>
    </button>
  </article>;
}

function excerpt(value: string, fallback: string) {
  return value.replace(/[#*_>`\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 46) || fallback;
}

function statusLabel(status: Asset["status"]) {
  return { queued: "排队中", indexing: "解析中", ready: "可检索", failed: "失败", deleted: "已删除" }[status];
}

function groupEntries(entries: ContentEntry[]) {
  const groups = new Map<string, ContentEntry[]>();
  for (const entry of entries) {
    const label = relativeDateLabel(entry.updatedAt);
    groups.set(label, [...(groups.get(label) || []), entry]);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function relativeDateLabel(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "最近 7 天";
  return "更早";
}

function formatEntryTime(value: string, locale: AppLocale) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit" }).format(date);
}
