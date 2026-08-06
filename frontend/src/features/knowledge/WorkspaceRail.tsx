import { useEffect, useMemo, useState } from "react";
import { FileText, Folder, Image, MoreHorizontal, Plus, Search, Settings2 } from "lucide-react";
import { useLocation } from "wouter";
import type { Workspace } from "../../types/domain";
import { FileTypeIcon } from "./FileTypeIcon";

type KnowledgeKind = "document" | "image";

const sections: Array<{ kind: KnowledgeKind; label: string; href: string }> = [
  { kind: "document", label: "文档知识", href: "/knowledge/documents" },
  { kind: "image", label: "图片素材", href: "/knowledge/images" }
];

function workspaceKind(workspace: Workspace): KnowledgeKind {
  return workspace.kind === "image" ? "image" : "document";
}

export function WorkspaceRail({ workspaces, activeId, kind, onSelect, onCreate, onManage }: {
  workspaces: Workspace[];
  activeId: string;
  kind: KnowledgeKind;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onManage: (workspace: Workspace | null) => void;
}) {
  const [, navigate] = useLocation();
  const active = workspaces.find((workspace) => workspace.id === activeId);
  const [scope, setScope] = useState<Workspace["scope"]>(active?.scope || "team");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (active?.scope) setScope(active.scope);
  }, [active?.id, active?.scope]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return workspaces.filter((workspace) => workspace.scope === scope && (!normalized || workspace.name.toLocaleLowerCase().includes(normalized)));
  }, [query, scope, workspaces]);

  function chooseScope(nextScope: Workspace["scope"]) {
    setScope(nextScope);
    const next = workspaces.find((workspace) => workspace.scope === nextScope && workspaceKind(workspace) === kind);
    if (next) onSelect(next.id);
  }

  function chooseWorkspace(workspace: Workspace) {
    const targetKind = workspaceKind(workspace);
    if (targetKind === kind) {
      onSelect(workspace.id);
      return;
    }
    const target = sections.find((section) => section.kind === targetKind)!;
    navigate(`${target.href}?workspace=${workspace.id}`);
  }

  function createWorkspace(targetKind: KnowledgeKind) {
    if (targetKind === kind) {
      onCreate();
      return;
    }
    const target = sections.find((section) => section.kind === targetKind)!;
    navigate(`${target.href}?create=1`);
  }

  const totalAssets = visible.reduce((total, workspace) => total + (workspace.asset_count || 0), 0);

  return (
    <aside className="workspace-rail">
      <header className="workspace-rail-head">
        <div><span>知识中心</span><strong>知识空间</strong></div>
        <span className="workspace-rail-tools"><button className="icon-button" onClick={() => onManage(null)} title="管理 Workspace"><Settings2 size={17} /></button><button className="icon-button" onClick={onCreate} title={`新建${kind === "document" ? "文档" : "图片"} Workspace`}><Plus size={18} /></button></span>
      </header>

      <div className="workspace-scope-switch" aria-label="Workspace 范围">
        <button className={scope === "personal" ? "active" : ""} onClick={() => chooseScope("personal")}>个人工作区</button>
        <button className={scope === "team" ? "active" : ""} onClick={() => chooseScope("team")}>团队工作区</button>
      </div>

      <label className="workspace-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识空间" /></label>

      <div className="workspace-groups">
        {sections.map((section) => {
          const items = visible.filter((workspace) => workspaceKind(workspace) === section.kind);
          return (
            <section key={section.kind}>
              <h3><span>{section.kind === "document" ? <FileText size={15} /> : <Image size={15} />}{section.label}</span><button onClick={() => createWorkspace(section.kind)} title={`新建${section.label}`}><Plus size={16} /></button></h3>
              {items.map((workspace) => (
                <div key={workspace.id} className={`workspace-rail-item ${activeId === workspace.id ? "active" : ""}`}><button className="workspace-rail-select" onClick={() => chooseWorkspace(workspace)}>{section.kind === "document" ? <FileTypeIcon format="folder" compact /> : <Image size={17} />}<span><b>{workspace.name}</b><em>{workspace.asset_count || 0} 项资产</em></span></button>{workspace.member_role === "owner" ? <button className="workspace-rail-manage" onClick={() => onManage(workspace)} title={`管理 ${workspace.name}`}><MoreHorizontal size={16} /></button> : null}</div>
              ))}
              {!items.length ? <div className="workspace-empty"><Folder size={15} />暂无内容</div> : null}
            </section>
          );
        })}
      </div>

      <footer className="workspace-storage"><span>本地存储</span><strong>{totalAssets} 项资产</strong></footer>
    </aside>
  );
}
