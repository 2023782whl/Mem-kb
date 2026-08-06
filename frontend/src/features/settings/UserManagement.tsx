import { Pencil, Plus, ShieldCheck, Trash2, UserRoundCheck, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { ConfirmActionDialog, EntityModal } from "../../shared/EntityDialogs";
import type { User } from "../../types/domain";
import { useI18n } from "../../i18n";
import { UserAvatar } from "../../shared/UserAvatar";

const roleLabels: Record<User["role"], string> = {
  admin: "管理员",
  editor: "编辑者",
  viewer: "查看者"
};

const roleDescriptions: Record<User["role"], string> = {
  admin: "管理用户、权限和全部内容",
  editor: "查看并编辑团队知识与笔记",
  viewer: "只读访问团队知识"
};

type UserDraft = Pick<User, "name" | "email" | "role" | "status"> & { password: string };

const emptyDraft: UserDraft = { name: "", email: "", password: "", role: "viewer", status: "active" };

export function UserManagement({ currentUser }: { currentUser: User }) {
  const { locale } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => ({
    total: users.length,
    editors: users.filter((user) => user.role === "editor" && user.status === "active").length,
    viewers: users.filter((user) => user.role === "viewer" && user.status === "active").length
  }), [users]);

  async function load() {
    try {
      const result = await api.users();
      setUsers(result.users);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "用户加载失败");
    }
  }

  useEffect(() => { void load(); }, []);

  function beginCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setOpen(true);
    setError("");
  }

  function beginEdit(user: User) {
    setEditing(user);
    setDraft({ name: user.name, email: user.email, password: "", role: user.role, status: user.status });
    setOpen(true);
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (editing) {
        await api.updateUser(editing.id, { ...draft, password: draft.password || undefined });
      } else {
        await api.createUser(draft);
      }
      setOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteUser(deleting.id);
      setDeleting(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-content user-management">
      <header className="settings-section-head with-actions">
        <div><h1>用户与权限</h1><p>管理员统一创建账号，并配置编辑或查看权限。</p></div>
        <button className="settings-primary-action" onClick={beginCreate}><Plus size={15} />添加用户</button>
      </header>
      {error ? <div className="inline-notice">{error}</div> : null}
      <section className="user-summary" aria-label="用户概览">
        <article><UsersRound size={18} /><span>全部用户</span><strong>{counts.total}</strong></article>
        <article><UserRoundCheck size={18} /><span>编辑者</span><strong>{counts.editors}</strong></article>
        <article><ShieldCheck size={18} /><span>查看者</span><strong>{counts.viewers}</strong></article>
      </section>
      <div className="enterprise-table user-table">
        <div className="enterprise-table-head"><span>用户</span><span>角色</span><span>状态</span><span>创建时间</span><span>操作</span></div>
        {users.map((user) => (
          <div key={user.id}>
            <span className="user-identity"><UserAvatar user={user} size={30} /><span><strong>{user.name}{user.id === currentUser.id ? <em>当前账号</em> : null}</strong><small>{user.email}</small></span></span>
            <span className={`role-badge ${user.role}`}><strong>{roleLabels[user.role]}</strong><small>{roleDescriptions[user.role]}</small></span>
            <span className={`account-status ${user.status}`}>{user.status === "active" ? "已启用" : "已停用"}</span>
            <span>{new Date(user.created_at).toLocaleDateString(locale)}</span>
            <span className="row-actions"><button onClick={() => beginEdit(user)} title="编辑用户"><Pencil size={14} /></button><button className="danger" disabled={user.id === currentUser.id} onClick={() => setDeleting(user)} title="删除用户"><Trash2 size={14} /></button></span>
          </div>
        ))}
      </div>
      {!users.length && !error ? <div className="settings-empty"><UsersRound size={30} /><strong>暂无用户</strong></div> : null}
      <EntityModal open={open} width={520} title={editing ? "编辑用户" : "添加用户"} description="权限由后端强制执行，查看者不能修改知识内容。" busy={busy} confirmText={editing ? "保存修改" : "创建账号"} confirmDisabled={!draft.name.trim() || !draft.email.trim() || (!editing && draft.password.length < 6)} onCancel={() => setOpen(false)} onConfirm={save}>
        <div className="user-editor-form">
          <label><span>姓名</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：张三" /></label>
          <label><span>邮箱</span><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="name@company.com" /></label>
          <label><span>{editing ? "重置密码（选填）" : "初始密码"}</span><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder={editing ? "留空则不修改" : "至少 6 位"} /></label>
          <div className="user-role-options"><span>系统角色</span>{(["admin", "editor", "viewer"] as const).map((role) => <button type="button" key={role} className={draft.role === role ? "active" : ""} disabled={editing?.id === currentUser.id && role !== "admin"} onClick={() => setDraft({ ...draft, role })}><strong>{roleLabels[role]}</strong><small>{roleDescriptions[role]}</small></button>)}</div>
          <label><span>账号状态</span><select value={draft.status} disabled={editing?.id === currentUser.id} onChange={(event) => setDraft({ ...draft, status: event.target.value as User["status"] })}><option value="active">启用</option><option value="disabled">停用</option></select></label>
        </div>
      </EntityModal>
      <ConfirmActionDialog open={Boolean(deleting)} danger busy={busy} title="删除用户" subject={deleting?.email} description="删除后无法登录；若账号仍拥有内容，请先停用或转移内容。" confirmText="确认删除" onCancel={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
