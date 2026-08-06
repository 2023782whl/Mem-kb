import { BookOpenCheck, Clock3, Link2, MoonStar, Play, Save, ScanSearch, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { ConsolidationConfig, ConsolidationLog, ConsolidationRun, Workspace } from "../../types/domain";
import { useI18n } from "../../i18n";

export function NightConsolidation() {
  const { locale } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [config, setConfig] = useState<ConsolidationConfig | null>(null);
  const [runs, setRuns] = useState<ConsolidationRun[]>([]);
  const [logs, setLogs] = useState<ConsolidationLog[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("02:30");
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const [workspaceResult, result] = await Promise.all([api.workspaces(), api.consolidation()]);
      setWorkspaces(workspaceResult.workspaces);
      setConfig(result.config);
      setRuns(result.runs);
      setLogs(result.logs);
      setEnabled(result.config.enabled);
      setScheduleTime(result.config.schedule_time);
      setWorkspaceIds(result.config.workspace_ids);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "夜间巩固配置加载失败");
    }
  }

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const result = await api.updateConsolidation({ enabled, scheduleTime, workspaceIds });
      setConfig(result.config);
      setNotice("夜间巩固设置已保存");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "保存失败");
    } finally { setBusy(false); }
  }

  async function runNow() {
    setBusy(true);
    setNotice("");
    try {
      await api.updateConsolidation({ enabled, scheduleTime, workspaceIds });
      await api.runConsolidation();
      await load();
      setNotice("巩固任务已提交，将在后台执行");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "巩固任务失败");
    } finally { setBusy(false); }
  }

  const latest = runs[0];
  const visibleLogs = useMemo(() => latest ? logs.filter((item) => item.run_id === latest.id) : [], [latest, logs]);
  return <div className="settings-content night-consolidation">
    <header className="settings-section-head with-actions"><div><h1>夜间巩固</h1><p>定时扫描历史对话，修复引用并重建知识实体关系。</p></div><button className="settings-primary-action" disabled={busy} onClick={() => void runNow()}><Play size={15} />{busy ? "执行中" : "立即运行"}</button></header>
    {notice ? <div className="inline-notice">{notice}</div> : null}
    <section className="consolidation-overview"><MoonStar /><div><strong>持续知识整理</strong><p>任务在服务端以 cron 调度运行，关闭浏览器不会中断。</p></div><label className="switch-control"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span />{enabled ? "已启用" : "未启用"}</label></section>
    <div className="consolidation-grid">
      <section className="consolidation-config"><h2>任务设置</h2><label><span><Clock3 />执行时间</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label><fieldset><legend>知识库范围</legend><p>不勾选时覆盖全部可用知识库。</p><div>{workspaces.map((workspace) => <label key={workspace.id}><input type="checkbox" checked={workspaceIds.includes(workspace.id)} onChange={(event) => setWorkspaceIds((current) => event.target.checked ? [...current, workspace.id] : current.filter((id) => id !== workspace.id))} /><span><strong>{workspace.name}</strong><em>{workspace.kind === "image" ? "图片知识" : "文档知识"}</em></span></label>)}</div></fieldset><button className="button secondary" disabled={busy} onClick={() => void save()}><Save size={15} />保存设置</button>{config?.next_run_at ? <p className="next-run">下次执行：{new Date(config.next_run_at).toLocaleString(locale)}</p> : null}</section>
      <section className="consolidation-result"><h2>最近执行</h2>{latest ? <><header><span className={latest.status}>{latest.status === "completed" ? "已完成" : latest.status === "failed" ? "失败" : "执行中"}</span><time>{new Date(latest.started_at).toLocaleString(locale)}</time></header><div className="consolidation-stats"><Stat icon={<ScanSearch />} label="扫描对话" value={latest.conversations_scanned} /><Stat icon={<Link2 />} label="实体关系" value={latest.relations_added} /><Stat icon={<Wrench />} label="修复引用" value={latest.citations_repaired} /><Stat icon={<BookOpenCheck />} label="整理节点" value={latest.structures_organized} /></div>{latest.error ? <p className="form-error">{latest.error}</p> : null}<div className="consolidation-log"><h3>执行日志</h3>{visibleLogs.map((log) => <div key={log.id} className={log.level}><time>{new Date(log.created_at).toLocaleTimeString(locale, { hour12: false })}</time><span>{log.message}</span></div>)}</div></> : <div className="settings-empty"><MoonStar size={30} /><strong>还没有执行记录</strong><span>保存设置并立即运行一次即可验证。</span></div>}</section>
    </div>
  </div>;
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return <article>{icon}<span>{label}</span><strong>{value}</strong></article>;
}
