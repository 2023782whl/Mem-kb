import { AlertTriangle, CheckCircle2, FileCheck2, Play, SearchCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { RagEvaluationQuery, RagEvaluationRun, Workspace } from "../../types/domain";

export function RagEvaluation() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [runs, setRuns] = useState<RagEvaluationRun[]>([]);
  const [activeRun, setActiveRun] = useState<RagEvaluationRun | null>(null);
  const [queries, setQueries] = useState<RagEvaluationQuery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([api.workspaces(), api.evaluations()]).then(([workspaceResult, runResult]) => {
      const documentWorkspaces = workspaceResult.workspaces.filter((item) => item.kind !== "image");
      setWorkspaces(documentWorkspaces);
      setWorkspaceId(documentWorkspaces[0]?.id || "");
      setRuns(runResult.runs);
      if (runResult.runs[0]) void openRun(runResult.runs[0]);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "评测数据加载失败"));
  }, []);

  async function openRun(run: RagEvaluationRun) {
    setActiveRun(run);
    try {
      const detail = await api.evaluation(run.id);
      setActiveRun(detail.run);
      setQueries(detail.queries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评测明细加载失败");
    }
  }

  async function runEvaluation() {
    if (!workspaceId || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.runEvaluation(workspaceId);
      const refreshed = await api.evaluations();
      setRuns(refreshed.runs);
      await openRun(result.run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评测运行失败");
    } finally {
      setBusy(false);
    }
  }

  return <div className="settings-content rag-evaluation">
    <header className="settings-section-head with-actions"><div><h1>RAG 评测</h1><p>用最近 90 天的真实引用作为基准，检查知识召回与引用可靠性。</p></div><div className="evaluation-run-control"><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><button className="settings-primary-action" disabled={!workspaceId || busy} onClick={() => void runEvaluation()}><Play size={15} />{busy ? "评测中" : "运行评测"}</button></div></header>
    {error ? <div className="inline-notice">{error}</div> : null}
    <section className="evaluation-metrics">
      <Metric icon={<SearchCheck />} label="召回率" value={activeRun ? activeRun.recall : null} detail="期望文档被命中的比例" />
      <Metric icon={<CheckCircle2 />} label="准确率" value={activeRun ? activeRun.accuracy : null} detail="命中文档中的相关比例" />
      <Metric icon={<FileCheck2 />} label="引用正确性" value={activeRun ? activeRun.citation_correctness : null} detail="引用仍可追溯的比例" />
    </section>
    <div className="evaluation-layout">
      <section className="evaluation-runs"><h2>评测记录</h2>{runs.map((run) => <button key={run.id} className={activeRun?.id === run.id ? "active" : ""} onClick={() => void openRun(run)}><span><strong>{run.workspace_name || run.workspace_id}</strong><em>{new Date(run.created_at).toLocaleString("zh-CN")}</em></span><b className={run.status}>{run.query_count} 条</b></button>)}{!runs.length ? <p>运行首次评测后显示记录。</p> : null}</section>
      <section className="evaluation-detail"><header><div><h2>查询明细</h2><p>{activeRun ? `${activeRun.workspace_name || activeRun.workspace_id} · ${activeRun.query_count} 条基准查询` : "选择一条评测记录"}</p></div></header>{queries.map((item) => <QueryResult key={item.id} item={item} />)}{activeRun && !queries.length ? <div className="evaluation-empty"><AlertTriangle /><strong>暂无可评测样本</strong><span>该知识库还没有带文档引用的成功问答；产生真实引用后再运行。</span></div> : null}</section>
    </div>
  </div>;
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: number | null; detail: string }) {
  return <article>{icon}<span>{label}</span><strong>{value === null ? "—" : `${Math.round(value * 100)}%`}</strong><p>{detail}</p></article>;
}

function QueryResult({ item }: { item: RagEvaluationQuery }) {
  return <details className={`evaluation-query ${item.status}`}><summary><i>{item.status === "passed" ? <CheckCircle2 /> : <AlertTriangle />}</i><span><strong>{item.question}</strong><em>召回 {Math.round(item.recall * 100)}% · 准确 {Math.round(item.accuracy * 100)}% · {item.duration_ms} ms</em></span><b>{item.status === "passed" ? "通过" : "失败"}</b></summary><div className="evaluation-query-body">{item.failure_reason ? <p className="evaluation-failure">失败原因：{item.failure_reason}</p> : null}<DocumentList label="命中文档" documents={item.hit_documents} tone="hit" /><DocumentList label="未命中文档" documents={item.missed_documents} tone="missed" /><p className={item.citation_correct ? "citation-ok" : "citation-bad"}>引用正确性：{item.citation_correct ? "通过" : "存在失效引用"}</p></div></details>;
}

function DocumentList({ label, documents, tone }: { label: string; documents: Array<{ id: string; title: string }>; tone: string }) {
  return <div className={`evaluation-documents ${tone}`}><strong>{label}</strong><span>{documents.length ? documents.map((item) => <em key={item.id}>{item.title}</em>) : <em>无</em>}</span></div>;
}
