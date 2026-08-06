import { useEffect, useRef, type RefObject } from "react";
import { BookMarked, ChevronDown, Globe2, Image, Paperclip, Send, Square, X } from "lucide-react";
import { LoadingDots } from "../../shared/LoadingSystem";
import { ModelPicker } from "../../shared/ModelPicker";
import type { ModelInfo, Workspace } from "../../types/domain";
import { FileTypeIcon } from "../knowledge/FileTypeIcon";

export interface QaOptions {
  documentQa: boolean;
  webSearch: boolean;
  imageSearch: boolean;
}

interface ChatComposerProps {
  value: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  models: ModelInfo[];
  modelId: string;
  workspaces: Workspace[];
  workspaceId: string;
  workspaceIds: string[];
  options: QaOptions;
  loading: boolean;
  uploading: boolean;
  disabled: boolean;
  compact?: boolean;
  attachment?: string;
  onChange: (value: string) => void;
  onModelChange: (id: string) => void;
  onWorkspaceScopeChange: (ids: string[]) => void;
  onOptionsChange: (options: QaOptions) => void;
  onSubmit: () => void;
  onStop: () => void;
  onUpload: (file: File) => void;
  onClearAttachment: () => void;
}

export function ChatComposer(props: ChatComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const workspacePickerRef = useRef<HTMLDetailsElement>(null);
  const {
    value, inputRef, models, modelId, workspaces, workspaceId, workspaceIds, options, loading,
    uploading, disabled, compact, attachment, onChange, onModelChange,
    onWorkspaceScopeChange, onOptionsChange, onSubmit, onStop, onUpload, onClearAttachment
  } = props;
  const selectedWorkspaceIds = workspaceIds.length ? workspaceIds : (workspaceId ? [workspaceId] : []);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceIds[0]);
  const workspaceScopeLabel = selectedWorkspaceIds.length === workspaces.length && workspaces.length > 1
    ? "全部知识库"
    : selectedWorkspaceIds.length > 1
      ? `${selectedWorkspaceIds.length} 个知识库`
      : selectedWorkspace?.name || "选择知识库";

  useEffect(() => {
    const closePicker = () => {
      workspacePickerRef.current?.removeAttribute("open");
      workspacePickerRef.current?.querySelector("summary")?.blur();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspacePickerRef.current?.contains(event.target as Node)) closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closePicker(); };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function toggleWorkspace(id: string, checked: boolean) {
    const next = checked
      ? [...new Set([...selectedWorkspaceIds, id])]
      : selectedWorkspaceIds.filter((workspaceId) => workspaceId !== id);
    onWorkspaceScopeChange(next.length ? next : (workspaceId ? [workspaceId] : []));
  }

  return (
    <div className={`chat-composer ${compact ? "compact" : ""} ${value.trim() ? "has-content" : ""}`}>
      {attachment ? <div className="composer-attachment"><FileTypeIcon title={attachment} compact /><span>{attachment}</span><button onClick={onClearAttachment} title="移除附件"><X size={14} /></button></div> : null}
      <textarea
        ref={inputRef}
        aria-label="输入问题"
        placeholder="有问题尽管问，或粘贴网页链接进行解读"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!disabled && !loading) onSubmit();
        }}
      />
      <div className="chat-composer-toolbar">
        <div className="chat-composer-options">
          <ModelPicker className="composer-model-picker" models={models} value={modelId} onChange={onModelChange} />
          <details ref={workspacePickerRef} className="workspace-scope-picker tone-knowledge">
            <summary aria-label="选择知识库范围"><BookMarked size={16} /><span>{workspaceScopeLabel}</span><ChevronDown className="scope-chevron" size={14} /></summary>
            <div>
              <header><strong>知识库检索范围</strong><span><button type="button" onClick={() => onWorkspaceScopeChange(workspaceId ? [workspaceId] : [])}>仅当前</button><button type="button" onClick={() => onWorkspaceScopeChange(workspaces.map((item) => item.id))}>全部</button></span></header>
              {workspaces.map((workspace) => <label key={workspace.id}><input type="checkbox" checked={selectedWorkspaceIds.includes(workspace.id)} onChange={(event) => toggleWorkspace(workspace.id, event.target.checked)} /><span>{workspace.name}</span></label>)}
            </div>
          </details>
          <ToggleButton tone="web" label="联网搜索" active={options.webSearch} onClick={() => onOptionsChange({ ...options, webSearch: !options.webSearch })}><Globe2 size={16} /></ToggleButton>
          <ToggleButton tone="image" label="图片检索" active={options.imageSearch} onClick={() => onOptionsChange({ ...options, imageSearch: !options.imageSearch })}><Image size={16} /></ToggleButton>
          <button className="composer-icon-button" disabled={uploading} onClick={() => fileRef.current?.click()} title={uploading ? "正在上传" : "上传文档"}>{uploading ? <LoadingDots compact /> : <Paperclip size={17} />}</button>
          <input ref={fileRef} className="visually-hidden" type="file" accept=".md,.txt,.pdf,.docx,.xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} />
        </div>
        {loading
          ? <button className="chat-send stop" onClick={onStop} title="停止生成"><Square size={18} /></button>
          : <button className="chat-send" onClick={onSubmit} disabled={disabled} title="发送"><Send size={19} /></button>}
      </div>
    </div>
  );
}

function ToggleButton({ tone, label, active, onClick, children }: { tone: "web" | "image"; label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`option-button tone-${tone} ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>{children}<span>{label}</span><i className="option-state" aria-hidden="true">{active ? "开" : "关"}</i></button>;
}
