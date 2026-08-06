import { useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "../../api/client";
import type { Workspace } from "../../types/domain";

export function CaptureDialog({ workspaces, defaultWorkspaceId, messageId, content, onClose }: {
  workspaces: Workspace[];
  defaultWorkspaceId: string;
  messageId: string;
  content: string;
  onClose: () => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);
  const [title, setTitle] = useState("知识问答沉淀");
  const [body, setBody] = useState(content);
  const [state, setState] = useState<"idle" | "saving" | "ready" | "error">("idle");

  async function save() {
    setState("saving");
    try {
      await api.capture(messageId, { workspaceId, title, content: body });
      setState("ready");
      window.setTimeout(onClose, 650);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <header><div><h2 id="capture-title">沉淀为知识文档</h2><p>保存后会写入 Workspace，并同步到 GBrain。</p></div><button className="icon-button" onClick={onClose} title="关闭"><X size={18} /></button></header>
        <label><span>目标 Workspace</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <label><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>Markdown 正文</span><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
        {state === "error" ? <p className="form-error">写入失败，请检查 GBrain 状态后重试。</p> : null}
        <footer><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={save} disabled={state === "saving" || !title.trim()}><Check size={17} />{state === "ready" ? "已沉淀" : state === "saving" ? "写入中" : "确认沉淀"}</button></footer>
      </section>
    </div>
  );
}
