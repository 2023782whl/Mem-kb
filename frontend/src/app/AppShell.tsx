import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, LogOut, MessageSquareText, NotebookPen, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";
import { api } from "../api/client";
import { Brand } from "../shared/Brand";
import { LanguageSwitcher } from "../shared/LanguageSwitcher";
import { AvatarEditorDialog } from "../shared/AvatarEditorDialog";
import { UserAvatar } from "../shared/UserAvatar";
import { TOPBAR_PANEL_SLOT_ID } from "../shared/TopbarPanelTrigger";
import type { User } from "../types/domain";

function GBrainStatus() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { api.health().then((result) => setOk(Boolean(result.gbrain?.ok))).catch(() => setOk(false)); }, []);
  return <span className={`status-chip ${ok ? "ok" : ""}`}><i />GBrain {ok === null ? "检测中" : ok ? "已连接" : "未连接"}</span>;
}

function NavItem({ href, label, tone, children }: { href: string; label: string; tone: string; children: ReactNode }) {
  const [location] = useLocation();
  const active = location === href || (href === "/knowledge/documents" && location.startsWith("/knowledge"));
  return <Link href={href} className={active ? "active" : ""} data-tone={tone} title={label}><i className="nav-glyph">{children}</i><span>{label}</span></Link>;
}

function pageMeta(location: string) {
  if (location.startsWith("/knowledge")) return { title: "知识中心", detail: "企业知识资产与素材" };
  if (location.startsWith("/notes")) return { title: "笔记", detail: "写作、沉淀与长期记忆" };
  if (location.startsWith("/settings")) return { title: "系统设置", detail: "账号、模型与运行状态" };
  return { title: "知识问答", detail: "有来源的企业级 AI 问答" };
}

export function AppShell({ user, onLogout, onUserChange, children }: { user: User; onLogout: () => void; onUserChange: (user: User) => void; children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const meta = pageMeta(location);
  const roleLabel = user.role === "admin" ? "系统管理员" : user.role === "editor" ? "编辑者" : "查看者";
  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="app-shell">
      <aside className="primary-sidebar">
        <Brand compact />
        <nav className="primary-nav" aria-label="主导航">
          <NavItem href="/qa" label="问答" tone="brand"><MessageSquareText size={20} /></NavItem>
          <NavItem href="/knowledge/documents" label="知识" tone="blue"><BookOpen size={20} /></NavItem>
          <NavItem href="/notes" label="笔记" tone="orange"><NotebookPen size={20} /></NavItem>
        </nav>
        <nav className="primary-nav primary-nav-bottom" aria-label="系统导航">
          <NavItem href="/settings" label="设置" tone="slate"><Settings size={20} /></NavItem>
        </nav>
        <div className="primary-user">
          <button className="primary-avatar-button" type="button" onClick={() => setAvatarOpen(true)} title="设置个人头像" aria-label="设置个人头像"><UserAvatar user={user} size={30} /></button>
          <button className="icon-button" onClick={() => void logout()} title="退出登录"><LogOut size={17} /></button>
        </div>
      </aside>
      <section className="app-stage">
        <header className="topbar">
          <div className="topbar-leading">
            <div id={TOPBAR_PANEL_SLOT_ID} className="topbar-panel-trigger-slot" />
            <div className="topbar-context"><strong>{meta.title}</strong><span>{meta.detail}</span></div>
          </div>
          <div className="topbar-actions"><GBrainStatus /><LanguageSwitcher /><button className="topbar-user" type="button" onClick={() => setAvatarOpen(true)} title="打开个人资料" aria-label="打开个人资料"><UserAvatar user={user} size={30} /><span><strong>{user.name}</strong><em>{roleLabel}</em></span></button></div>
        </header>
        {children}
      </section>
      <AvatarEditorDialog open={avatarOpen} user={user} onClose={() => setAvatarOpen(false)} onSaved={onUserChange} />
    </div>
  );
}
