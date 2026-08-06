import { History, MessageSquareText, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmActionDialog } from "../../shared/EntityDialogs";
import { LoadingDots } from "../../shared/LoadingSystem";
import type { Conversation, Workspace } from "../../types/domain";
import { useI18n, type AppLocale } from "../../i18n";

export function ConversationHistory({ open, embedded = false, pinned = false, loading, conversations, workspaces, activeId, onClose, onTogglePinned, onNew, onSelect, onDelete }: {
  open: boolean;
  embedded?: boolean;
  pinned?: boolean;
  loading: boolean;
  conversations: Conversation[];
  workspaces: Workspace[];
  activeId: string;
  onClose: () => void;
  onTogglePinned?: () => void;
  onNew: () => void;
  onSelect: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void | Promise<void>;
}) {
  const { locale } = useI18n();
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const visibleConversations = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(keyword)) : conversations;
  }, [conversations, search]);
  if (!open && !embedded) return null;
  const content = (
      <aside className={embedded ? "conversation-rail" : "history-drawer"} aria-label="历史会话">
        <header>
          <div><MessageSquareText size={18} /><strong>会话</strong></div>
          {embedded ? <span className="panel-header-actions">
            <button className={`icon-button ${pinned ? "active" : ""}`} onClick={onTogglePinned} title={pinned ? "取消固定问答历史" : "固定问答历史"} aria-pressed={pinned}><Pin size={16} fill={pinned ? "currentColor" : "none"} /></button>
          </span> : <button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button>}
        </header>
        <button className="history-new" onClick={onNew}><Plus size={17} />新对话</button>
        <label className="history-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话" /></label>
        <div className="history-section-heading"><span><History size={15} />问答历史</span><b>{visibleConversations.length}</b></div>
        <div className="history-list">
          {loading ? <p role="status"><LoadingDots /><span className="visually-hidden">正在加载会话</span></p> : null}
          {!loading && !visibleConversations.length ? <p>{search ? "没有匹配的会话" : "还没有历史会话"}</p> : null}
          {visibleConversations.map((conversation) => (
            <div key={conversation.id} className={`history-item ${conversation.id === activeId ? "active" : ""}`}>
              <button className="history-select" onClick={() => onSelect(conversation)}>
                <MessageSquareText size={17} />
                <span><strong>{conversation.title}</strong><em>{workspaceNames.get(conversation.workspace_id) || "知识库"} · {formatDate(conversation.updated_at, locale)}</em></span>
              </button>
              <button className="history-delete" onClick={() => setDeleteTarget(conversation)} title="删除会话" aria-label={`删除会话：${conversation.title}`}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </aside>
  );
  const confirm = <ConfirmActionDialog open={Boolean(deleteTarget)} danger busy={loading} title="删除会话" subject={deleteTarget?.title} description="会话消息和引用记录将永久删除，此操作无法撤销。" confirmText="删除会话" onCancel={() => setDeleteTarget(null)} onConfirm={async () => { if (!deleteTarget) return; await onDelete(deleteTarget); setDeleteTarget(null); }} />;
  if (embedded) return <>{content}{confirm}</>;
  return (
    <><div className="history-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{content}</div>{confirm}</>
  );
}

function formatDate(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
