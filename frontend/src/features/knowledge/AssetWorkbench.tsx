import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Code2, Download, Eye, Image as ImageIcon, Network, NotebookPen, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { EmptyState } from "../../shared/EmptyState";
import { MarkdownContent } from "../../shared/MarkdownContent";
import type { Asset, GraphEdge, GraphNode } from "../../types/domain";
import { AssetImage } from "./AssetImage";
import { AssetStatus, formatBytes } from "./AssetStatus";
import { FileTypeIcon, resolveFileFormat } from "./FileTypeIcon";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { useLocation } from "wouter";

export type WorkbenchView = "graph" | "summary" | "preview" | "source";

interface AssetPreview {
  asset: Asset;
  text: string;
}

export function AssetWorkbench({
  workspaceName,
  graph,
  selectedAsset,
  view,
  onViewChange,
  onSelectNode,
  onChanged,
  onDelete,
  onManage,
  onDownload
}: {
  workspaceName: string;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  selectedAsset?: Asset;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  onSelectNode: (node: GraphNode) => void;
  onChanged: () => Promise<void> | void;
  onDelete: (asset: Asset) => Promise<void> | void;
  onManage: (asset: Asset) => void;
  onDownload: (asset: Asset) => Promise<void> | void;
}) {
  const [, navigate] = useLocation();
  const [preview, setPreview] = useState<AssetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedAsset) {
      setPreview(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setPreview(null);
    setError("");
    api.preview(selectedAsset.id, controller.signal).then((result) => {
      if (!active) return;
      setPreview(result);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "资产加载失败");
    });
    return () => { active = false; controller.abort(); };
  }, [selectedAsset?.id, selectedAsset?.updated_at]);

  const asset = preview?.asset || selectedAsset;
  const isDocument = Boolean(asset && asset.type !== "image");
  const vision = useMemo(() => {
    const metadata = asset?.metadata || {};
    return ((metadata.vision as Record<string, unknown> | undefined) || metadata) as Record<string, unknown>;
  }, [asset]);

  async function retry() {
    if (!asset) return;
    setBusy(true);
    setError("");
    try {
      await api.retryAsset(asset.id);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重试失败");
    } finally {
      setBusy(false);
    }
  }

  async function openInNotes() {
    if (!asset || !isDocument || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.createNoteFromAsset(asset.id);
      navigate(`/notes?workspace=${encodeURIComponent(asset.workspace_id)}&source=${encodeURIComponent(asset.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建工作副本失败");
    } finally {
      setBusy(false);
    }
  }

  const title = view === "graph" ? "知识关系图谱" : asset?.title || "资产详情";
  const description = view === "graph"
    ? `${workspaceName || "Workspace"} · 仅展示真实资产与可追溯关系`
    : view === "summary" ? "节点摘要与资产标签" : asset?.summary || "查看解析内容与索引状态";

  return (
    <section className="knowledge-detail">
      <header className="workbench-header">
        <div className="workbench-heading">
          {view !== "graph" && asset ? <AssetKindIcon asset={asset} compact /> : null}
          <div><h2>{title}</h2><p>{description}</p></div>
        </div>
        <div className="workbench-actions">
          <div className="segmented-control workbench-tabs" role="tablist" aria-label="知识工作区视图">
            <button type="button" className={view === "graph" ? "active" : ""} onClick={() => onViewChange("graph")}><Network size={15} />图谱</button>
            {asset ? <button type="button" className={view === "preview" ? "active" : ""} onClick={() => onViewChange("preview")}><Eye size={15} />{asset.type === "image" ? "素材详情" : "预览"}</button> : null}
            {isDocument ? <button type="button" className={view === "source" ? "active" : ""} onClick={() => onViewChange("source")} disabled={!preview}><Code2 size={15} />Markdown 原文</button> : null}
          </div>
          {asset ? <>{isDocument ? <button type="button" className="icon-button" onClick={() => void openInNotes()} title="在笔记中打开" disabled={busy}><NotebookPen size={16} /></button> : null}<button type="button" className="icon-button" onClick={() => void onDownload(asset)} title="下载原文件"><Download size={16} /></button><button type="button" className="icon-button" onClick={() => onManage(asset)} title="管理资产"><Settings2 size={16} /></button><button type="button" className="icon-button danger-icon" onClick={() => void onDelete(asset)} title="移入回收站" aria-label={`移入回收站：${asset.title}`}><Trash2 size={16} /></button></> : null}
          <span className="graph-status"><Network size={15} />{graph.nodes.filter((node) => node.assetId).length} 个真实节点</span>
        </div>
      </header>

      {error ? <div className="workbench-error" role="alert">{error}</div> : null}
      <div className={`detail-body workbench-body view-${view}`}>
        {view === "graph" ? <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} selectedAssetId={asset?.id} onSelect={onSelectNode} /> : null}
        {view !== "graph" && !asset ? <EmptyState title="请选择一个资产" detail="从左侧列表或知识图谱中选择文档或图片。" /> : null}
        {view === "summary" && asset ? <AssetSummary asset={asset} onEnter={() => onViewChange("preview")} /> : null}
        {view === "preview" && asset?.type === "image" ? <ImagePreview asset={asset} vision={vision} /> : null}
        {view === "preview" && isDocument ? <DocumentPreview asset={asset!} text={preview?.text || ""} /> : null}
        {view === "source" && isDocument ? <pre className="markdown-source workbench-source"><code>{preview?.text || "暂无可预览正文"}</code></pre> : null}
      </div>

      {asset?.status === "failed" && view !== "graph" ? <footer className="workbench-footer"><span>{asset.error || "解析失败"}</span><button type="button" className="button secondary compact" onClick={() => void retry()} disabled={busy}><RefreshCw size={15} />重新解析</button></footer> : null}
    </section>
  );
}

function AssetSummary({ asset, onEnter }: { asset: Asset; onEnter: () => void }) {
  return (
    <article className="workbench-summary">
      <header><AssetKindIcon asset={asset} /><div><span>当前节点</span><h3>{asset.title}</h3><p>{asset.type === "image" ? "图片素材" : resolveFileFormat(asset.format, asset.title).toUpperCase()} · {formatBytes(asset.size_bytes)}</p></div></header>
      <section><h4>内容摘要</h4><p className="asset-summary-text">{asset.summary || "该资产暂未生成摘要。"}</p></section>
      <section><h4>标签</h4>{asset.tags?.length ? <div className="tag-row">{asset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : <p>暂无标签</p>}</section>
      <button type="button" className="button primary" onClick={onEnter}>进入当前{asset.type === "image" ? "图片" : "文档"}<ArrowRight size={16} /></button>
    </article>
  );
}

function AssetKindIcon({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  return asset.type === "image"
    ? <span className={`asset-kind-image ${compact ? "compact" : ""}`}><ImageIcon size={compact ? 17 : 21} /></span>
    : <FileTypeIcon format={asset.format} title={asset.title} compact={compact} />;
}

function DocumentPreview({ asset, text }: { asset: Asset; text: string }) {
  return (
    <article className="workbench-document">
      <div className="detail-metadata">
        <div><span>状态</span><AssetStatus status={asset.status} /></div>
        <div><span>类型</span><strong>{resolveFileFormat(asset.format, asset.title).toUpperCase()}</strong></div>
        <div><span>解析器</span><strong>{asset.processing_provider || "历史资产"}</strong></div>
        <div><span>大小</span><strong>{formatBytes(asset.size_bytes)}</strong></div>
      </div>
      <section className="document-content"><MarkdownContent source={text || "暂无可预览正文"} /></section>
    </article>
  );
}

function ImagePreview({ asset, vision }: { asset: Asset; vision: Record<string, unknown> }) {
  return (
    <article className="workbench-image-preview">
      <div className="asset-preview-image"><AssetImage assetId={asset.id} alt={asset.title} original /></div>
      <section><h3>VLM 图片描述</h3><p>{asset.summary || "等待图片理解结果"}</p></section>
      <div className="vision-grid">
        <div><span>识别商品</span><strong>{String(vision.product || "未识别")}</strong></div>
        <div><span>使用场景</span><strong>{String(vision.scene || "未识别")}</strong></div>
        <div className="wide"><span>OCR 文字</span><p>{asset.ocr_text || String(vision.ocr || "无")}</p></div>
      </div>
    </article>
  );
}
