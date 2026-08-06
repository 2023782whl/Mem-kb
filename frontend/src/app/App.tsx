import { lazy, Suspense, useEffect, useState } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { api } from "../api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { RouteSkeleton } from "../shared/LoadingSystem";
import type { User } from "../types/domain";
import { AppShell } from "./AppShell";

const KnowledgeCenterPage = lazy(() => import("../features/knowledge/KnowledgeCenterPage").then((module) => ({ default: module.KnowledgeCenterPage })));
const KnowledgeQaPage = lazy(() => import("../features/qa/KnowledgeQaPage").then((module) => ({ default: module.KnowledgeQaPage })));
const NotesPage = lazy(() => import("../features/notes/NotesPage").then((module) => ({ default: module.NotesPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));

function skeletonVariant(location: string) {
  if (location.startsWith("/knowledge")) return "knowledge" as const;
  if (location.startsWith("/notes")) return "notes" as const;
  if (location.startsWith("/settings")) return "settings" as const;
  return "qa" as const;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootRevision, setBootRevision] = useState(0);
  const [location, navigate] = useLocation();

  useEffect(() => {
    const unauthorized = () => setUser(null);
    window.addEventListener("aiteam:unauthorized", unauthorized);
    api.me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
    return () => window.removeEventListener("aiteam:unauthorized", unauthorized);
  }, [bootRevision]);

  if (booting) {
    return (
      <RouteSkeleton
        variant={skeletonVariant(location)}
        title="正在连接知识中心"
        detail="校验账号与 Workspace 权限 · 初始化中"
        onRetry={() => {
          setBooting(true);
          setBootRevision((value) => value + 1);
        }}
      />
    );
  }

  return <Suspense fallback={<RouteSkeleton variant={skeletonVariant(location)} title="正在加载工作台" detail="正在准备页面组件" />}>
    <Switch>
      <Route path="/login">{user ? <Redirect to="/qa" replace /> : <LoginPage onLogin={(nextUser) => { setUser(nextUser); navigate("/qa", { replace: true }); }} />}</Route>
      <Route path="/qa">{user ? <AppShell user={user} onLogout={() => setUser(null)} onUserChange={setUser}><KnowledgeQaPage /></AppShell> : <Redirect to="/login" replace />}</Route>
      <Route path="/knowledge/documents">{user ? <AppShell user={user} onLogout={() => setUser(null)} onUserChange={setUser}><KnowledgeCenterPage kind="document" /></AppShell> : <Redirect to="/login" replace />}</Route>
      <Route path="/knowledge/images">{user ? <AppShell user={user} onLogout={() => setUser(null)} onUserChange={setUser}><KnowledgeCenterPage kind="image" /></AppShell> : <Redirect to="/login" replace />}</Route>
      <Route path="/notes">{user ? <AppShell user={user} onLogout={() => setUser(null)} onUserChange={setUser}><NotesPage /></AppShell> : <Redirect to="/login" replace />}</Route>
      <Route path="/settings">{user ? <AppShell user={user} onLogout={() => setUser(null)} onUserChange={setUser}><SettingsPage user={user} onUserChange={setUser} /></AppShell> : <Redirect to="/login" replace />}</Route>
      <Route path="/knowledge"><Redirect to="/knowledge/documents" replace /></Route>
      <Route path="/discover"><Redirect to="/qa" replace /></Route>
      <Route><Redirect to={user ? "/qa" : "/login"} replace /></Route>
    </Switch>
  </Suspense>;
}
