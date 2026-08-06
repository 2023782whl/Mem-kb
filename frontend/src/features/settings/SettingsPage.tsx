import {
  Activity, Boxes, Database, Gauge, KeyRound, MessageSquareText, MoonStar, RadioTower, Settings,
  ShieldCheck, UserRound, UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { api } from "../../api/client";
import type { GBrainOperations, ModelInfo, User } from "../../types/domain";
import { ChannelIntegrations } from "./ChannelIntegrations";
import { TraceLogs } from "./TraceLogs";
import { UserManagement } from "./UserManagement";
import { RagEvaluation } from "./RagEvaluation";
import { NightConsolidation } from "./NightConsolidation";

type SettingsView = "account" | "users" | "models" | "channels" | "traces" | "evaluation" | "consolidation" | "system" | "audit";

const views: Array<{ id: SettingsView; label: string; detail: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "account", label: "账号与权限", detail: "身份和访问范围", icon: UserRound },
  { id: "users", label: "用户与权限", detail: "成员和系统角色", icon: UsersRound },
  { id: "models", label: "模型配置", detail: "可用模型与能力", icon: Boxes },
  { id: "channels", label: "渠道接入", detail: "微信与知识范围", icon: RadioTower },
  { id: "traces", label: "对话 Trace", detail: "问答全链路日志", icon: MessageSquareText },
  { id: "evaluation", label: "RAG 评测", detail: "召回与引用质量", icon: Gauge },
  { id: "consolidation", label: "夜间巩固", detail: "定时整理知识", icon: MoonStar },
  { id: "system", label: "运行状态", detail: "数据库与 GBrain", icon: Activity },
  { id: "audit", label: "审计记录", detail: "管理员操作追踪", icon: ShieldCheck }
];

export function SettingsPage({ user }: { user: User }) {
  const [view, setView] = useState<SettingsView>("account");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; gbrain: Record<string, unknown> } | null>(null);
  const [operations, setOperations] = useState<GBrainOperations | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.models(), api.health()])
      .then(([modelResult, healthResult]) => {
        setModels(modelResult.models);
        setHealth({ ok: healthResult.ok, gbrain: healthResult.gbrain });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "系统信息加载失败"));
    if (user.role === "admin") {
      void Promise.all([api.gbrainOperations(), api.users()])
        .then(([operationResult, userResult]) => {
          setOperations(operationResult);
          setUsers(userResult.users);
        })
        .catch(() => {
          setOperations(null);
          setUsers([]);
        });
    }
  }, [user.role]);

  const configuredModels = useMemo(() => models.filter((model) => model.configured), [models]);

  return (
    <main className="settings-layout">
      <aside className="settings-nav">
        <header><Settings size={20} /><div><span>企业管理</span><strong>系统设置</strong></div></header>
        <nav>{views.filter((item) => !["users", "channels", "traces", "evaluation", "consolidation"].includes(item.id) || user.role === "admin").map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon size={17} /><span><strong>{item.label}</strong><em>{item.detail}</em></span></button>;
        })}</nav>
      </aside>
      <section className="settings-stage">
        {error ? <div className="inline-notice">{error}</div> : null}
        {view === "account" ? <AccountSettings user={user} /> : null}
        {view === "users" ? <UserManagement currentUser={user} /> : null}
        {view === "models" ? <ModelSettings models={models} /> : null}
        {view === "channels" && user.role === "admin" ? <ChannelIntegrations /> : null}
        {view === "traces" && user.role === "admin" ? <TraceLogs users={users} /> : null}
        {view === "evaluation" && user.role === "admin" ? <RagEvaluation /> : null}
        {view === "consolidation" && user.role === "admin" ? <NightConsolidation /> : null}
        {view === "system" ? <SystemSettings health={health} configured={configuredModels.length} operations={operations} /> : null}
        {view === "audit" ? <AuditSettings user={user} operations={operations} /> : null}
      </section>
    </main>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return <header className="settings-section-head"><div><h1>{title}</h1><p>{detail}</p></div></header>;
}

function AccountSettings({ user }: { user: User }) {
  const roleName = user.role === "admin" ? "系统管理员" : user.role === "editor" ? "编辑者" : "查看者";
  return <div className="settings-content"><SectionHeader title="账号与权限" detail="当前登录身份和企业访问边界。" /><section className="settings-form-section"><div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-fields"><label>姓名<input value={user.name} readOnly /></label><label>邮箱<input value={user.email} readOnly /></label><label>租户标识<input value={user.tenant_id} readOnly /></label><label>系统角色<input value={roleName} readOnly /></label></div></section><section className="permission-note"><KeyRound size={18} /><div><strong>权限由服务端强制执行</strong><p>管理员拥有全局管理权，编辑者可以维护知识，查看者仅能读取和问答。</p></div></section></div>;
}

function ModelSettings({ models }: { models: ModelInfo[] }) {
  return <div className="settings-content"><SectionHeader title="模型配置" detail="后端已加载的模型与能力，不在浏览器保存密钥。" /><div className="enterprise-table model-table"><div className="enterprise-table-head"><span>模型</span><span>类型</span><span>视觉</span><span>状态</span></div>{models.map((model) => <div key={model.id}><span className="model-identity">{model.iconUrl ? <img src={model.iconUrl} alt="" /> : <Boxes size={18} />}<span><strong>{model.name}</strong><em>{model.modelName}</em></span></span><span>{model.kind}</span><span>{model.supportsVision ? "支持" : "-"}</span><span className={model.configured ? "status-text ok" : "status-text"}>{model.configured ? "可用" : "未配置"}</span></div>)}</div></div>;
}

function SystemSettings({ health, configured, operations }: { health: { ok: boolean; gbrain: Record<string, unknown> } | null; configured: number; operations: GBrainOperations | null }) {
  const gbrainOk = Boolean(health?.gbrain?.ok);
  return <div className="settings-content"><SectionHeader title="运行状态" detail="业务 API、模型网关和知识引擎的实时状态。" /><div className="system-status-grid"><article><Database size={20} /><span>业务数据库</span><strong>{health?.ok ? "正常" : "检测中"}</strong></article><article><Activity size={20} /><span>GBrain</span><strong>{gbrainOk ? "已连接" : "未连接"}</strong></article><article><Boxes size={20} /><span>可用模型</span><strong>{configured}</strong></article></div><div className="system-detail-list"><div><span>GBrain 版本</span><strong>{String(health?.gbrain?.version || "-")}</strong></div><div><span>存储引擎</span><strong>{String(health?.gbrain?.engine || "-")}</strong></div><div><span>联邦知识源</span><strong>{operations?.sourceStatuses.length ?? "仅管理员可见"}</strong></div></div></div>;
}

function AuditSettings({ user, operations }: { user: User; operations: GBrainOperations | null }) {
  if (user.role !== "admin") return <div className="settings-content"><SectionHeader title="审计记录" detail="仅系统管理员可以查看企业操作记录。" /><div className="settings-empty"><ShieldCheck size={30} /><strong>当前账号无审计权限</strong><span>服务端已拒绝该范围的数据访问。</span></div></div>;
  return <div className="settings-content"><SectionHeader title="审计记录" detail="最近的系统管理和 GBrain 操作。" /><div className="enterprise-table audit-table"><div className="enterprise-table-head"><span>时间</span><span>操作人</span><span>操作</span><span>资源</span></div>{(operations?.auditLogs || []).map((entry) => <div key={entry.id}><span>{new Date(entry.created_at).toLocaleString("zh-CN")}</span><span>{entry.user_name || "系统"}</span><strong>{entry.action}</strong><span>{String(entry.resource_id || "-")}</span></div>)}</div>{!operations?.auditLogs?.length ? <div className="settings-empty"><ShieldCheck size={30} /><strong>暂无审计记录</strong><span>产生管理操作后会显示在这里。</span></div> : null}</div>;
}
