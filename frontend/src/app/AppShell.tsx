import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, CircleUserRound, LogOut, MessageSquareText, NotebookPen, Settings } from "lucide-react";
import { Link, useLocation } from "wouter";
import { api } from "../api/client";
import { Brand } from "../shared/Brand";
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

export function AppShell({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const [location, navigate] = useLocation();
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
          <span title={`${user.name} · ${roleLabel}`}><CircleUserRound size={21} /></span>
          <button className="icon-button" onClick={() => void logout()} title="退出登录"><LogOut size={17} /></button>
        </div>
      </aside>
      <section className="app-stage">
        <header className="topbar">
          <div className="topbar-context"><strong>{meta.title}</strong><span>{meta.detail}</span></div>
          <div className="topbar-actions"><GBrainStatus /><span className="topbar-user"><CircleUserRound size={17} /><span><strong>{user.name}</strong><em>{roleLabel}</em></span></span></div>
        </header>
        {children}
      </section>
    </div>
  );
}
