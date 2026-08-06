import { useEffect, useState } from "react";
import { Archive, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../../api/client";
import { EntityModal } from "../../shared/EntityDialogs";
import type { Workspace, WorkspaceMember } from "../../types/domain";

export function WorkspaceManageDialog({ open, workspace, onClose, onChanged }: {
  open: boolean;
  workspace: Workspace | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [archived, setArchived] = useState<Workspace[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceMember["role"]>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [archivedResult, memberResult] = await Promise.all([
      api.workspaces("archived"),
      workspace ? api.workspaceMembers(workspace.id) : Promise.resolve({ members: [] as WorkspaceMember[] })
    ]);
    setArchived(archivedResult.workspaces);
    setMembers(memberResult.members);
  }

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name || "");
    setDescription(workspace?.description || "");
    setError("");
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Workspace 管理信息加载失败"));
  }, [open, workspace?.id]);

  async function run(action: () => Promise<unknown>, close = false) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
      if (close) onClose();
      else await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntityModal
      open={open}
      width={680}
      title={workspace ? "管理 Workspace" : "Workspace 管理"}
      description="重命名、归档、恢复，并维护团队成员角色。"
      busy={busy}
      confirmText={workspace ? "保存基本信息" : "完成"}
      confirmDisabled={Boolean(workspace && !name.trim())}
      onCancel={onClose}
      onConfirm={() => workspace ? run(() => api.updateWorkspace(workspace.id, { name: name.trim(), description }), true) : onClose()}
    >
      {workspace ? <>
        <label className="entity-field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="entity-field"><span>描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {workspace.scope === "team" ? <section className="workspace-member-editor">
          <header><Users size={17} /><strong>成员与角色</strong></header>
          <div className="workspace-member-add"><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱" /><select value={role} onChange={(event) => setRole(event.target.value as WorkspaceMember["role"])}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="owner">Owner</option></select><button type="button" onClick={() => void run(async () => { await api.addWorkspaceMember(workspace.id, email.trim(), role); setEmail(""); })} disabled={!email.trim() || busy}><UserPlus size={15} />添加</button></div>
          <div className="workspace-member-list">{members.map((member) => <div key={member.user_id}><span><strong>{member.name}</strong><em>{member.email}</em></span><select value={member.role} onChange={(event) => void run(() => api.updateWorkspaceMember(workspace.id, member.user_id, event.target.value as WorkspaceMember["role"]))}><option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="button" title="移除成员" onClick={() => void run(() => api.removeWorkspaceMember(workspace.id, member.user_id))}><Trash2 size={14} /></button></div>)}</div>
        </section> : null}
        <button type="button" className="workspace-archive-button" onClick={() => void run(() => api.archiveWorkspace(workspace.id), true)}><Archive size={15} />归档此 Workspace</button>
      </> : null}

      <section className="workspace-archive-list">
        <header><Archive size={17} /><strong>已归档 Workspace</strong></header>
        {archived.map((item) => <div key={item.id}><span><strong>{item.name}</strong><em>{item.asset_count || 0} 项资产</em></span><button type="button" onClick={() => void run(() => api.restoreWorkspace(item.id))}><RotateCcw size={14} />恢复</button><button type="button" className="danger" title="永久删除空 Workspace" onClick={() => void run(() => api.deleteWorkspace(item.id))}><Trash2 size={14} /></button></div>)}
        {!archived.length ? <p>暂无已归档 Workspace</p> : null}
      </section>
      {error ? <p className="form-error">{error}</p> : null}
    </EntityModal>
  );
}
