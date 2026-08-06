import QRCode from "qrcode";
import {
  CheckCircle2, Link2, MessageCircle, QrCode, RadioTower, RefreshCw, Send, ShieldCheck,
  Trash2, Unplug, UsersRound, X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { ChannelBinding, ChannelDelivery, ChannelIdentity, ChannelMessage, User, Workspace } from "../../types/domain";

type DetailTab = "scope" | "identities" | "messages" | "deliveries";
type QrSession = { code: string; image: string; expiresAt: string; status: string };

export function ChannelIntegrations() {
  const [bindings, setBindings] = useState<ChannelBinding[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [activeId, setActiveId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createScope, setCreateScope] = useState<string[]>([]);
  const [autoScanId, setAutoScanId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [channelResult, workspaceResult, userResult] = await Promise.all([api.channels(), api.workspaces(), api.users()]);
      setBindings(channelResult.bindings);
      setWorkspaces(workspaceResult.workspaces);
      setUsers(userResult.users.filter((item) => item.status === "active"));
      setActiveId((current) => channelResult.bindings.some((item) => item.id === current) ? current : channelResult.bindings[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "渠道信息加载失败");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createBinding() {
    if (!createScope.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.createChannel(createScope);
      setBindings((current) => [result.binding, ...current]);
      setActiveId(result.binding.id);
      setAutoScanId(result.binding.id);
      setCreateOpen(false);
      setCreateScope([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建渠道失败");
    } finally {
      setBusy(false);
    }
  }

  const active = bindings.find((item) => item.id === activeId) || null;
  return <div className="settings-content channel-settings">
    <header className="settings-section-head with-actions"><div><h1>渠道接入</h1><p>把个人微信连接到指定知识库，私聊和群聊只在授权范围内召回。</p></div><button className="button primary compact" onClick={() => setCreateOpen(true)}><Link2 size={15} />接入微信</button></header>
    {error ? <div className="inline-notice">{error}</div> : null}
    {!bindings.length ? <div className="settings-empty channel-empty"><RadioTower size={32} /><strong>尚未接入渠道</strong><span>选择一个或多个知识库后扫码绑定个人微信。</span><button className="button compact" onClick={() => setCreateOpen(true)}>开始接入</button></div> : <div className="channel-layout">
      <aside className="channel-list">{bindings.map((binding) => <button key={binding.id} className={binding.id === activeId ? "active" : ""} onClick={() => setActiveId(binding.id)}>
        <span className="channel-icon"><MessageCircle size={17} /></span><span><strong>微信</strong><em>{binding.workspace_names?.join("、") || `${binding.workspace_ids.length} 个知识库`}</em></span><ChannelStatus binding={binding} />
      </button>)}</aside>
      {active ? <ChannelDetail
        binding={active}
        workspaces={workspaces}
        users={users}
        autoScan={autoScanId === active.id}
        onAutoScan={() => setAutoScanId("")}
        onChanged={load}
      /> : null}
    </div>}
    {createOpen ? <div className="modal-backdrop"><section className="channel-create-dialog" role="dialog" aria-modal="true" aria-label="接入微信"><header><div><QrCode size={18} /><span><strong>接入个人微信</strong><em>选择微信可以调用的知识库</em></span></div><button onClick={() => setCreateOpen(false)} aria-label="关闭"><X /></button></header><WorkspaceChecks workspaces={workspaces} value={createScope} onChange={setCreateScope} /><footer><button className="button compact" onClick={() => setCreateOpen(false)}>取消</button><button className="button primary compact" disabled={!createScope.length || busy} onClick={createBinding}>{busy ? "创建中" : "创建并扫码"}</button></footer></section></div> : null}
  </div>;
}

function ChannelDetail({ binding, workspaces, users, autoScan, onAutoScan, onChanged }: {
  binding: ChannelBinding;
  workspaces: Workspace[];
  users: User[];
  autoScan: boolean;
  onAutoScan: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<DetailTab>("scope");
  const [scope, setScope] = useState(binding.workspace_ids);
  const [qr, setQr] = useState<QrSession | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [identities, setIdentities] = useState<ChannelIdentity[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [deliveries, setDeliveries] = useState<ChannelDelivery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qrGeneration = useRef(0);

  useEffect(() => { setScope(binding.workspace_ids); setQr(null); setError(""); qrGeneration.current += 1; }, [binding.id, binding.workspace_ids]);

  const startQr = useCallback(async () => {
    const generation = ++qrGeneration.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.channelQrCode(binding.id);
      const image = await QRCode.toDataURL(result.content, { width: 232, margin: 1, color: { dark: "#202124", light: "#ffffff" } });
      if (generation === qrGeneration.current) setQr({ code: result.qrcode, image, expiresAt: result.expiresAt, status: "wait" });
    } catch (reason) {
      if (generation === qrGeneration.current) setError(reason instanceof Error ? reason.message : "二维码获取失败");
    } finally {
      if (generation === qrGeneration.current) setBusy(false);
    }
  }, [binding.id]);

  useEffect(() => {
    if (!autoScan) return;
    onAutoScan();
    void startQr();
  }, [autoScan, onAutoScan, startQr]);

  useEffect(() => {
    if (!qr) return;
    const generation = qrGeneration.current;
    const remaining = Math.max(0, Date.parse(qr.expiresAt) - Date.now());
    const refreshTimer = window.setTimeout(() => { if (generation === qrGeneration.current) void startQr(); }, remaining + 250);
    const pollTimer = window.setTimeout(async () => {
      try {
        const result = await api.channelQrStatus(binding.id, qr.code, verifyCode);
        if (generation !== qrGeneration.current) return;
        if (result.status === "confirmed") {
          setQr(null);
          await onChanged();
          return;
        }
        if (result.status === "expired" || result.status === "verify_code_blocked") {
          await startQr();
          return;
        }
        setQr((current) => current ? { ...current, status: result.status } : null);
      } catch (reason) {
        if (generation === qrGeneration.current) setError(reason instanceof Error ? reason.message : "扫码状态检查失败");
      }
    }, 2_000);
    return () => { window.clearTimeout(refreshTimer); window.clearTimeout(pollTimer); };
  }, [binding.id, onChanged, qr, startQr, verifyCode]);

  useEffect(() => {
    if (tab === "identities") void api.channelIdentities(binding.id).then((result) => setIdentities(result.identities)).catch(() => setIdentities([]));
    if (tab === "messages") void api.channelMessages(binding.id).then((result) => setMessages(result.messages)).catch(() => setMessages([]));
    if (tab === "deliveries") void api.channelDeliveries(binding.id).then((result) => setDeliveries(result.deliveries)).catch(() => setDeliveries([]));
  }, [binding.id, tab]);

  async function saveScope() {
    if (!scope.length) return;
    setBusy(true);
    try { await api.updateChannel(binding.id, scope); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "知识库范围保存失败"); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("断开后需要重新扫码才能恢复，消息与 Trace 日志会保留。确定断开吗？")) return;
    setBusy(true);
    try { qrGeneration.current += 1; setQr(null); await api.disconnectChannel(binding.id); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "断开失败"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("确定删除这个微信渠道吗？身份绑定、消息记录和投递日志会一并删除，且无法恢复。")) return;
    setBusy(true);
    setError("");
    try {
      qrGeneration.current += 1;
      setQr(null);
      await api.deleteChannel(binding.id);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "渠道删除失败");
    } finally {
      setBusy(false);
    }
  }

  const needsScan = binding.status !== "active" || !binding.connected;
  return <section className="channel-detail">
    <header><div><MessageCircle size={20} /><span><strong>个人微信</strong><em>创建于 {formatTime(binding.created_at)}</em></span><ChannelStatus binding={binding} /></div><div className="channel-header-actions">{needsScan ? <button className="button primary compact" disabled={busy} onClick={() => void startQr()}><QrCode size={14} />{busy ? "获取中" : "扫码接入"}</button> : <button className="button compact danger-outline" disabled={busy} onClick={disconnect}><Unplug size={14} />断开接入</button>}<button className="button compact danger-outline" disabled={busy} onClick={remove}><Trash2 size={14} />删除</button></div></header>
    {error ? <div className="inline-notice">{error}</div> : null}
    {qr ? <div className="wechat-qr-panel"><img src={qr.image} alt="微信接入二维码" /><strong>{qrHint(qr.status)}</strong><span>二维码到期后自动刷新 · {formatCountdown(qr.expiresAt)}</span>{qr.status === "need_verifycode" ? <label>手机显示的数字<input value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" /></label> : null}<button className="text-button" onClick={() => void startQr()}><RefreshCw size={13} />刷新二维码</button></div> : null}
    <nav className="channel-tabs">{(["scope", "identities", "messages", "deliveries"] as DetailTab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{detailTabLabel(item)}</button>)}</nav>
    {tab === "scope" ? <div className="channel-panel"><div className="panel-heading"><div><strong>知识库召回范围</strong><span>微信消息只能检索勾选范围，服务端逐项校验权限。</span></div><button className="button compact" disabled={busy || !scope.length} onClick={saveScope}>保存范围</button></div><WorkspaceChecks workspaces={workspaces} value={scope} onChange={setScope} /></div> : null}
    {tab === "identities" ? <div className="channel-panel"><div className="panel-heading"><div><strong>微信身份绑定</strong><span>未绑定身份默认使用渠道创建者权限。</span></div></div><div className="channel-data-list">{identities.map((identity) => <div key={identity.id}><span className="data-icon"><UsersRound /></span><span><strong>{identity.display_name || identity.external_user_id}</strong><em>{identity.is_group ? "群聊成员" : "私聊用户"} · {identity.external_user_id}</em></span><select value={identity.user_id || ""} onChange={async (event) => { await api.bindChannelIdentity(binding.id, identity.id, event.target.value || null); setIdentities((current) => current.map((item) => item.id === identity.id ? { ...item, user_id: event.target.value || null } : item)); }}><option value="">使用创建者</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div>)}{!identities.length ? <EmptyRow label="收到微信消息后会在这里生成身份。" /> : null}</div></div> : null}
    {tab === "messages" ? <LogList rows={messages.map((item) => ({ id: item.id, icon: item.direction === "inbound" ? <MessageCircle /> : <Send />, title: item.direction === "inbound" ? "收到消息" : "发送回复", content: item.content, meta: `${item.is_group ? "群聊" : "私聊"} · ${item.status} · ${formatTime(item.created_at)}`, error: item.error }))} empty="暂无微信消息" /> : null}
    {tab === "deliveries" ? <LogList rows={deliveries.map((item) => ({ id: item.id, icon: item.status === "delivered" ? <CheckCircle2 /> : <Send />, title: item.status === "delivered" ? "投递成功" : `投递${item.status}`, content: item.external_conversation_id, meta: `${item.attempts} 次尝试 · ${formatTime(item.created_at)}`, error: item.last_error }))} empty="暂无投递日志" /> : null}
  </section>;
}

function WorkspaceChecks({ workspaces, value, onChange }: { workspaces: Workspace[]; value: string[]; onChange: (value: string[]) => void }) {
  return <div className="workspace-check-grid">{workspaces.map((workspace) => <label key={workspace.id}><input type="checkbox" checked={value.includes(workspace.id)} onChange={(event) => onChange(event.target.checked ? [...value, workspace.id] : value.filter((id) => id !== workspace.id))} /><span><strong>{workspace.name}</strong><em>{workspace.scope === "personal" ? "个人知识" : "团队知识"} · {workspace.asset_count || 0} 项资产</em></span></label>)}</div>;
}

function ChannelStatus({ binding }: { binding: ChannelBinding }) {
  const active = binding.status === "active" && binding.connected;
  return <span className={`channel-status ${active ? "connected" : binding.status}`}><i />{active ? "已连接" : binding.status === "expired" ? "已过期" : binding.status === "disabled" ? "已断开" : "待扫码"}</span>;
}

function LogList({ rows, empty }: { rows: Array<{ id: string; icon: React.ReactNode; title: string; content: string; meta: string; error?: string | null }>; empty: string }) {
  return <div className="channel-panel channel-data-list">{rows.map((row) => <div key={row.id}><span className="data-icon">{row.icon}</span><span><strong>{row.title}</strong><em>{row.content}</em><small>{row.meta}{row.error ? ` · ${row.error}` : ""}</small></span></div>)}{!rows.length ? <EmptyRow label={empty} /> : null}</div>;
}

function EmptyRow({ label }: { label: string }) { return <div className="channel-log-empty"><ShieldCheck size={22} /><span>{label}</span></div>; }
function detailTabLabel(tab: DetailTab) { return ({ scope: "知识库", identities: "身份绑定", messages: "消息记录", deliveries: "投递日志" })[tab]; }
function qrHint(status: string) { return status === "scaned" || status === "scaned_but_redirect" ? "已扫码，请在手机确认" : status === "need_verifycode" ? "请输入手机显示的数字" : "使用微信扫描二维码"; }
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function formatCountdown(expiresAt: string) { return Date.parse(expiresAt) > Date.now() ? "约 2 分钟有效" : "正在刷新"; }
