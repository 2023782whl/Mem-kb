import { ArrowRight, Code2, Eye, Image as ImageIcon, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../../api/client";
import { MarkdownContent } from "../../shared/MarkdownContent";
import { LoadingBlock } from "../../shared/LoadingSystem";
import type { Asset } from "../../types/domain";
import { AssetImage } from "../knowledge/AssetImage";
import { AssetStatus, formatBytes } from "../knowledge/AssetStatus";
import { FileTypeIcon, resolveFileFormat } from "../knowledge/FileTypeIcon";

type PreviewMode = "preview" | "source";

export function WorkspaceAssetViewer({ asset, opening, onOpenInNotes }: { asset: Asset; opening: boolean; onOpenInNotes: () => void }) {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<PreviewMode>("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isImage = asset.type === "image";

  useEffect(() => {
    setMode("preview");
    setText("");
    setError("");
    if (asset.type === "image") return;
    let active = true;
    setLoading(true);
    api.preview(asset.id)
      .then((result) => active && setText(result.text))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "资产加载失败"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [asset.id, asset.type, asset.updated_at]);

  const openInKnowledgeCenter = () => navigate(assetRoute(asset));

  return (
    <section className="workspace-asset-viewer">
      <header className="workspace-asset-header">
        <div className="workspace-asset-title">
          {isImage ? <span className="asset-kind-image"><ImageIcon size={21} /></span> : <FileTypeIcon format={asset.format} title={asset.title} />}
          <div><span>Workspace 知识资产</span><h1>{asset.title}</h1><p>{isImage ? "图片素材" : resolveFileFormat(asset.format, asset.title).toUpperCase()} · {formatBytes(asset.size_bytes)}</p></div>
        </div>
        {!isImage ? <div className="segmented-control workspace-asset-tabs"><button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} />预览</button><button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")} disabled={!text}><Code2 size={15} />Markdown</button></div> : null}
      </header>
      <div className={`workspace-asset-notice ${error ? "visible" : ""}`}>{error ? <p role="alert">{error}</p> : null}</div>
      <div className="workspace-asset-body">
        {loading ? <LoadingBlock pending label="正在读取知识资产" className="workspace-asset-loading" /> : null}
        {!loading && isImage ? <div className="workspace-asset-image"><AssetImage assetId={asset.id} alt={asset.title} /></div> : null}
        {!loading && !isImage && mode === "preview" ? <article className="workspace-asset-document"><MarkdownContent source={text || asset.summary || "暂无可预览正文"} /></article> : null}
        {!loading && !isImage && mode === "source" ? <pre className="workspace-asset-source"><code>{text}</code></pre> : null}
      </div>
      <footer className="workspace-asset-footer"><span>原始知识资产只读；编辑会创建带来源关系的工作副本。</span><div><button className="button secondary compact" onClick={openInKnowledgeCenter}>查看原始资产<ArrowRight size={15} /></button>{!isImage ? <button className="button primary compact" onClick={onOpenInNotes} disabled={opening}><NotebookPen size={15} />{opening ? "正在创建" : "在笔记中打开"}</button> : null}</div></footer>
    </section>
  );
}

export function WorkspaceAssetInspector({ asset }: { asset: Asset }) {
  const [, navigate] = useLocation();
  return (
    <aside className="note-inspector workspace-asset-inspector">
      <header><strong>{asset.type === "image" ? "素材信息" : "文档信息"}</strong><AssetStatus status={asset.status} /></header>
      <div className="inspector-scroll workspace-asset-metadata">
        <section><h3>内容摘要</h3><p>{asset.summary || "该资产暂未生成摘要。"}</p></section>
        <section><h3>标签</h3>{asset.tags.length ? <div className="editable-tags">{asset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : <p>暂无标签</p>}</section>
        <section className="asset-property-list">
          <h3>资产状态</h3>
          <dl><div><dt>格式</dt><dd>{resolveFileFormat(asset.format, asset.title).toUpperCase()}</dd></div><div><dt>大小</dt><dd>{formatBytes(asset.size_bytes)}</dd></div><div><dt>GBrain</dt><dd>{asset.gbrain_slug ? "已同步" : "待同步"}</dd></div><div><dt>更新时间</dt><dd>{new Date(asset.updated_at).toLocaleString("zh-CN")}</dd></div></dl>
        </section>
        <button className="button secondary wide" onClick={() => navigate(assetRoute(asset))}>打开知识中心<ArrowRight size={15} /></button>
      </div>
    </aside>
  );
}

function assetRoute(asset: Asset) {
  const page = asset.type === "image" ? "/knowledge/images" : "/knowledge/documents";
  return `${page}?workspace=${encodeURIComponent(asset.workspace_id)}&asset=${encodeURIComponent(asset.id)}`;
}
