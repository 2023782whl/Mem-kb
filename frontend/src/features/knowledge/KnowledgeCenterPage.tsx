import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownUp, Boxes, ChevronRight, FileText, FolderTree, Grid2X2, Image as ImageIcon,
  List, PackagePlus, Plus, RotateCcw, Search, Settings2, Trash2, Upload, X
} from "lucide-react";
import { api } from "../../api/client";
import { EmptyState } from "../../shared/EmptyState";
import { ConfirmActionDialog, EntityModal } from "../../shared/EntityDialogs";
import { StageProgress } from "../../shared/LoadingSystem";
import { useWorkspaces } from "../../shared/useWorkspaces";
import type { Asset, BusinessUnit, Category, GraphEdge, GraphNode, Product, Workspace } from "../../types/domain";
import { AssetImage } from "./AssetImage";
import { AssetManageDialog } from "./AssetManageDialog";
import { AssetWorkbench, type WorkbenchView } from "./AssetWorkbench";
import { AssetStatus, formatBytes } from "./AssetStatus";
import { FileTypeIcon, resolveFileFormat } from "./FileTypeIcon";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceManageDialog } from "./WorkspaceManageDialog";
import { ResizeHandle } from "../../shared/ResizeHandle";
import { usePersistentNumber } from "../../shared/usePersistentState";
import { useI18n, type AppLocale } from "../../i18n";
import { useDockedPanel } from "../../shared/useDockedPanel";
import { TopbarPanelTrigger } from "../../shared/TopbarPanelTrigger";

function isDeletedAsset(asset?: Asset | null) {
  return Boolean(asset?.deleted_at || asset?.status === "deleted");
}

const DEFAULT_ASSET_RAIL_WIDTH = 244;
const DEFAULT_GRAPH_WIDTH = 520;
const MIN_GRAPH_WIDTH = 380;
const MAX_GRAPH_WIDTH = 1280;
const MIN_ASSET_BROWSER_WIDTH = 340;
const KNOWLEDGE_WORKSPACE_PINNED_KEY = "mem-kb:knowledge-workspace-pinned-v2";

export function KnowledgeCenterPage({ kind }: { kind: "document" | "image" }) {
  const { locale } = useI18n();
  const { allWorkspaces, active, activeId, setActiveId, loading, error: workspaceError, refresh: refreshWorkspaces } = useWorkspaces(kind);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>("summary");
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [assetManagerTarget, setAssetManagerTarget] = useState<Asset | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [managedWorkspace, setManagedWorkspace] = useState<Workspace | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [catalogDialog, setCatalogDialog] = useState<"category" | "product" | null>(null);
  const [catalogManagerOpen, setCatalogManagerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">(kind === "image" ? "grid" : "list");
  const [assetType, setAssetType] = useState<"all" | "document" | "image" | "video">("all");
  const [sortNewest, setSortNewest] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const imageSearchRef = useRef<HTMLInputElement>(null);
  const loadRequestRef = useRef(0);
  const pageRef = useRef<HTMLElement>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [assetRailWidth, setAssetRailWidth] = usePersistentNumber("mem-kb:knowledge-asset-rail-width", DEFAULT_ASSET_RAIL_WIDTH, 190, 340);
  const [graphWidth, setGraphWidth] = usePersistentNumber("mem-kb:knowledge-graph-width", DEFAULT_GRAPH_WIDTH, MIN_GRAPH_WIDTH, MAX_GRAPH_WIDTH);
  const workspacePanel = useDockedPanel(KNOWLEDGE_WORKSPACE_PINNED_KEY);

  const availableGraphWidth = pageWidth
    ? pageWidth - (workspacePanel.open ? assetRailWidth + 8 : 0) - 8 - MIN_ASSET_BROWSER_WIDTH
    : MAX_GRAPH_WIDTH;
  const maxGraphWidth = Math.max(MIN_GRAPH_WIDTH, Math.min(MAX_GRAPH_WIDTH, availableGraphWidth));
  const renderedGraphWidth = Math.min(graphWidth, maxGraphWidth);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const syncWidth = () => setPageWidth(page.clientWidth);
    syncWidth();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncWidth);
    observer?.observe(page);
    if (!observer) window.addEventListener("resize", syncWidth);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", syncWidth);
    };
  }, []);

  const scopedAssets = kind === "image" && (categoryId || productId)
    ? assets.filter((asset) => (!categoryId || asset.category_id === categoryId) && (!productId || asset.product_id === productId))
    : assets;
  const visibleAssets = scopedAssets
    .filter((asset) => assetType === "all" || (assetType === "document" ? asset.type !== "image" && asset.type !== "video" : asset.type === assetType))
    .slice()
    .sort((left, right) => {
      const order = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      return sortNewest ? order : -order;
    });
  const groupedAssets = groupAssets(visibleAssets);
  const selectedAsset = assets.find((asset) => asset.id === selectedId && !isDeletedAsset(asset));
  const deleteTargetIsDeleted = isDeletedAsset(deleteTarget);

  async function loadWorkspace(silent = false) {
    const requestId = ++loadRequestRef.current;
    if (!activeId) {
      setAssets([]);
      setGraph({ nodes: [], edges: [] });
      return;
    }
    if (!silent) setBusy(true);
    try {
      const workspaceId = activeId;
      const [assetResult, graphResult, categoryResult, productResult] = await Promise.all([
        api.assets(workspaceId, kind === "image" ? "image" : "all", search, showDeleted),
        // The list and its summary remain usable if a secondary graph/category
        // request is temporarily unavailable during a workspace switch.
        api.graph(workspaceId).catch(() => ({ nodes: [], edges: [] })),
        kind === "image" ? api.categories(workspaceId).catch(() => null) : Promise.resolve(null),
        kind === "image" ? api.products(workspaceId).catch(() => null) : Promise.resolve(null)
      ]);
      if (requestId !== loadRequestRef.current) return;
      setAssets(assetResult.assets);
      setGraph(graphResult);
      const linkedAssetId = new URLSearchParams(window.location.search).get("asset");
      setSelectedId((current) => {
        if (linkedAssetId && assetResult.assets.some((asset) => asset.id === linkedAssetId)) return linkedAssetId;
        return assetResult.assets.some((asset) => asset.id === current) ? current : assetResult.assets[0]?.id || "";
      });
      if (linkedAssetId && assetResult.assets.some((asset) => asset.id === linkedAssetId)) {
        setWorkbenchView("preview");
      }
      if (categoryResult && productResult) {
        setCategories(categoryResult.categories);
        setProducts(productResult.products);
      }
    } catch (reason) {
      if (requestId === loadRequestRef.current) setNotice(reason instanceof Error ? reason.message : "知识资产加载失败");
    } finally {
      if (!silent) setBusy(false);
    }
  }

  useEffect(() => { void loadWorkspace(); }, [activeId, kind, showDeleted]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") !== "1") return;
    setWorkspaceDialog(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, [kind]);
  useEffect(() => {
    setSelectedId("");
    setWorkbenchView("summary");
  }, [activeId, kind]);
  useEffect(() => {
    if (!activeId || !assets.some((asset) => asset.status === "queued" || asset.status === "indexing")) return;
    const timer = window.setInterval(() => void loadWorkspace(true), 1500);
    return () => window.clearInterval(timer);
  }, [activeId, assets]);

  async function runSearch() {
    if (!activeId) return;
    const requestId = ++loadRequestRef.current;
    setBusy(true);
    try {
      if (kind === "image" && search.trim() && !showDeleted) {
        const result = await api.imageSearchText(activeId, search.trim());
        if (requestId === loadRequestRef.current) setAssets(result.assets);
      } else {
        const result = await api.assets(activeId, kind === "image" ? "image" : "all", search.trim(), showDeleted);
        if (requestId === loadRequestRef.current) setAssets(result.assets);
      }
    } catch (reason) {
      if (requestId === loadRequestRef.current) setNotice(reason instanceof Error ? reason.message : "检索失败");
    } finally {
      if (requestId === loadRequestRef.current) setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!activeId || !files?.length) return;
    if (kind === "image" && (!categoryId || !productId)) {
      setNotice("上传图片前请选择三级类目和具体商品");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const selectedFiles = Array.from(files);
      setUploadProgress(Object.fromEntries(selectedFiles.map((file) => [`${file.name}-${file.lastModified}`, 0])));
      await Promise.all(selectedFiles.map((file) => {
        const key = `${file.name}-${file.lastModified}`;
        return api.upload(activeId, file, { categoryId, productId }, (percent) => setUploadProgress((current) => ({ ...current, [key]: percent })));
      }));
      await Promise.all([loadWorkspace(), refreshWorkspaces()]);
      setNotice(`${files.length} 个文件已进入解析队列`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setBusy(false);
      setUploadProgress({});
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function searchByImage(files: FileList | null) {
    const file = files?.[0];
    if (!activeId || !file) return;
    const requestId = ++loadRequestRef.current;
    setBusy(true);
    try {
      const result = await api.imageSearchImage(activeId, file);
      if (requestId === loadRequestRef.current) {
        setAssets(result.assets);
        setNotice(`找到 ${result.assets.length} 个相似素材`);
      }
    } catch (reason) {
      if (requestId === loadRequestRef.current) setNotice(reason instanceof Error ? reason.message : "图搜图失败");
    } finally {
      if (requestId === loadRequestRef.current) setBusy(false);
      if (imageSearchRef.current) imageSearchRef.current.value = "";
    }
  }

  function selectGraphNode(node: GraphNode) {
    if (node.assetId) {
      setSelectedId(node.assetId);
      setWorkbenchView("summary");
    }
  }

  async function deleteAsset(asset: Asset) {
    const permanent = isDeletedAsset(asset);
    const wasSelected = asset.id === selectedId;
    if (wasSelected) {
      setSelectedId("");
      setWorkbenchView("summary");
    }
    setBusy(true);
    setNotice("");
    try {
      const result = permanent ? await api.purgeAsset(asset.id) : await api.deleteAsset(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      await Promise.all([loadWorkspace(true), refreshWorkspaces()]);
      setNotice(permanent
        ? (result.cleanupWarnings.length ? `资产已永久删除，${result.cleanupWarnings.length} 个文件需要人工清理` : "资产已永久删除")
        : "资产已移入回收站，可随时恢复");
    } catch (reason) {
      if (wasSelected) {
        setSelectedId(asset.id);
        setWorkbenchView("preview");
      }
      setNotice(reason instanceof Error ? reason.message : "资产删除失败");
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  function toggleDeletedAssets() {
    loadRequestRef.current += 1;
    setShowDeleted((current) => !current);
    setAssets([]);
    setSelectedId("");
    setWorkbenchView("summary");
    setDeleteTarget(null);
    setNotice("");
  }

  async function restoreAsset(asset: Asset) {
    setBusy(true);
    setNotice("");
    try {
      await api.restoreAsset(asset.id);
      await Promise.all([loadWorkspace(true), refreshWorkspaces()]);
      setNotice("资产已恢复并进入重建索引队列");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "资产恢复失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      ref={pageRef}
      className={`knowledge-page resizable-knowledge-page ${kind === "image" ? "image-mode" : ""} ${workspacePanel.open ? "" : "workspace-collapsed"}`}
      style={{ "--asset-rail-width": `${assetRailWidth}px`, "--graph-pane-width": `${renderedGraphWidth}px` } as CSSProperties}
    >
      <WorkspaceRail workspaces={allWorkspaces} activeId={activeId} kind={kind} pinned={workspacePanel.pinned} onSelect={(id, options) => { if (id !== activeId) { setSelectedId(""); setWorkbenchView("summary"); setActiveId(id); } if (!options?.keepPanelOpen) workspacePanel.closeTemporaryPanel(); }} onCreate={() => setWorkspaceDialog(true)} onManage={(workspace) => { setManagedWorkspace(workspace); setWorkspaceManagerOpen(true); }} onTogglePinned={workspacePanel.togglePinned} />
      <ResizeHandle label="调整资产列表宽度" onDelta={(delta) => setAssetRailWidth((current) => current + delta)} onReset={() => setAssetRailWidth(DEFAULT_ASSET_RAIL_WIDTH)} />
      <TopbarPanelTrigger label={workspacePanel.open ? "收起知识空间" : "展开知识空间"} expanded={workspacePanel.open} onToggle={workspacePanel.open ? workspacePanel.closePanel : workspacePanel.openPanel} />
      <section className="asset-browser" onPointerDown={workspacePanel.closeTemporaryPanel}>
        <header className="asset-browser-head">
          <div className="workspace-title"><span>{kind === "document" ? <FileText size={25} /> : <ImageIcon size={25} />}</span><div><h1>{active?.name || (loading ? "加载中" : "暂无 Workspace")}</h1><p>{active?.scope === "personal" ? "个人沉淀" : "团队知识"} · {active?.description || (kind === "document" ? "运营知识与 SOP" : "多层类目素材资产")}</p></div></div>
          <button className="button primary" onClick={() => fileRef.current?.click()} disabled={!activeId || busy}><Upload size={17} />上传{kind === "document" ? "文档" : "图片"}</button>
          <input ref={fileRef} className="visually-hidden" type="file" multiple accept={kind === "document" ? ".md,.txt,.pdf,.docx,.doc,.xlsx,.xls,.csv,.xmind,.pptx,.ppt" : ".jpg,.jpeg,.png,.gif,.bmp,.webp,.tiff,.tif,.heic,.heif"} onChange={(event) => void upload(event.target.files)} />
        </header>
        {Object.keys(uploadProgress).length ? <div className="upload-progress-list">{Object.entries(uploadProgress).map(([key, percent]) => <div key={key}><span>{key.replace(/-\d+$/, "")}</span><StageProgress progress={percent} stages={["上传文件", "安全校验", "提交解析"]} /></div>)}</div> : null}

        {kind === "image" ? (
          <CatalogBar
            categories={categories}
            products={products}
            categoryId={categoryId}
            productId={productId}
            onCategory={(id) => { setCategoryId(id); setProductId(""); }}
            onProduct={setProductId}
            onCreate={setCatalogDialog}
            onManage={() => setCatalogManagerOpen(true)}
          />
        ) : null}

        <div className="asset-content-toolbar">
          <div className="asset-content-title"><strong>内容元素</strong><span>({scopedAssets.length})</span></div>
          <div className="asset-content-actions">
            <button className={`icon-button ${searchOpen ? "active" : ""}`} onClick={() => setSearchOpen((current) => !current)} title="搜索内容"><Search size={17} /></button>
            <button className="icon-button" onClick={() => setSortNewest((current) => !current)} title={sortNewest ? "当前按最新排序" : "当前按最早排序"}><ArrowDownUp size={17} /></button>
            {kind === "image" ? <><button className="icon-button" onClick={() => imageSearchRef.current?.click()} title="图搜图"><ImageIcon size={17} /></button><input ref={imageSearchRef} className="visually-hidden" type="file" accept="image/*" onChange={(event) => void searchByImage(event.target.files)} /></> : null}
            <div className="view-switch" aria-label="切换资产视图"><button className={`icon-button ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")} title="列表视图"><List size={17} /></button><button className={`icon-button ${viewMode === "grid" ? "active" : ""}`} onClick={() => setViewMode("grid")} title="卡片视图"><Grid2X2 size={17} /></button></div>
          </div>
          <div className="asset-type-tabs" aria-label="按内容类型筛选">
            {(["all", ...(kind === "image" ? ["image"] : ["document", "image", "video"])] as Array<"all" | "document" | "image" | "video">).map((type) => <button key={type} className={assetType === type ? "active" : ""} onClick={() => setAssetType(type)}>{type === "all" ? "全部" : type === "document" ? "文档" : type === "image" ? "图片" : "视频"}</button>)}
            <button className={showDeleted ? "active danger-tab" : ""} onClick={toggleDeletedAssets}><Trash2 size={13} />回收站</button>
          </div>
          {searchOpen ? <div className="search-field asset-search-field"><Search size={16} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void runSearch()} placeholder={kind === "image" ? "按画面、商品、卖点搜索" : "搜索标题或摘要"} /><button className="icon-button" onClick={() => void runSearch()} title="搜索"><ChevronRight size={17} /></button></div> : null}
        </div>

        {notice || workspaceError ? <div className="inline-notice"><span>{notice || workspaceError}</span><button className="icon-button" onClick={() => setNotice("")}><X size={15} /></button></div> : null}
        {kind === "image" ? (
          <div className="image-asset-grid">
            {visibleAssets.map((asset) => { const deleted = isDeletedAsset(asset); return <div key={asset.id} className={`image-asset-item ${selectedId === asset.id ? "selected" : ""}`}><button className="image-asset-main" onClick={() => { if (!deleted) { setSelectedId(asset.id); setWorkbenchView("preview"); } }}><span className="image-frame">{deleted ? <span className="deleted-asset-placeholder"><Trash2 size={24} /></span> : <AssetImage assetId={asset.id} alt={asset.title} />}<AssetStatus status={asset.status} /></span><strong>{asset.title}</strong><p>{asset.summary || "等待 VLM 生成描述"}</p></button>{deleted ? <div className="asset-trash-actions"><button onClick={() => void restoreAsset(asset)} title="恢复图片"><RotateCcw size={15} /></button><button className="danger" onClick={() => setDeleteTarget(asset)} title="永久删除图片"><Trash2 size={15} /></button></div> : <button className="asset-row-delete" onClick={() => setDeleteTarget(asset)} title="移入回收站" aria-label={`移入回收站：${asset.title}`}><Trash2 size={15} /></button>}</div>; })}
            {!visibleAssets.length && !busy ? <EmptyState title="这里还没有图片" detail="选择三级类目和商品后上传素材。" /> : null}
          </div>
        ) : viewMode === "grid" ? (
          <div className="document-grid">
            {visibleAssets.map((asset) => { const deleted = isDeletedAsset(asset); return <article key={asset.id} className={`document-card ${selectedId === asset.id ? "selected" : ""}`}><button className="document-card-main" onClick={() => { if (!deleted) { setSelectedId(asset.id); setWorkbenchView("preview"); } }}><header><FileTypeIcon format={asset.format} title={asset.title} /><span><strong>{asset.title}</strong><em>{resolveFileFormat(asset.format, asset.title).toUpperCase()}</em></span></header><p>{asset.summary || "等待生成文档摘要"}</p><div className="document-tags">{asset.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}{!asset.tags.length ? <span>暂无标签</span> : null}</div><footer><AssetStatus status={asset.status} /><time>{formatAssetDate(asset.updated_at, locale)}</time></footer></button>{deleted ? <div className="asset-trash-actions"><button onClick={() => void restoreAsset(asset)} title="恢复文档"><RotateCcw size={15} /></button><button className="danger" onClick={() => setDeleteTarget(asset)} title="永久删除文档"><Trash2 size={15} /></button></div> : <button className="asset-row-delete" onClick={() => setDeleteTarget(asset)} title="移入回收站" aria-label={`移入回收站：${asset.title}`}><Trash2 size={15} /></button>}</article>; })}
            {!visibleAssets.length && !busy ? <EmptyState title="这里还没有文档" detail="上传 Markdown、PDF、Word 或 Excel 开始沉淀。" /> : null}
          </div>
        ) : (
          <div className="document-list">
            {groupedAssets.map((group) => <Fragment key={group.label}>
              <h3 className="asset-date-heading">{group.label}</h3>
              {group.items.map((asset) => { const deleted = isDeletedAsset(asset); return <div key={asset.id} className={`asset-list-row ${selectedId === asset.id ? "selected" : ""}`}><button className="asset-row-main" onClick={() => { if (!deleted) { setSelectedId(asset.id); setWorkbenchView("preview"); } }}><FileTypeIcon format={asset.format} title={asset.title} /><span><strong>{asset.title}</strong><em>{resolveFileFormat(asset.format, asset.title).toUpperCase()} · {formatBytes(asset.size_bytes)}</em></span><span className="asset-row-tail"><AssetStatus status={asset.status} /><time>{formatAssetDate(asset.updated_at, locale)}</time></span></button>{deleted ? <div className="asset-trash-actions"><button onClick={() => void restoreAsset(asset)} title="恢复文档"><RotateCcw size={15} /></button><button className="danger" onClick={() => setDeleteTarget(asset)} title="永久删除文档"><Trash2 size={15} /></button></div> : <button className="asset-row-delete" onClick={() => setDeleteTarget(asset)} title="移入回收站" aria-label={`移入回收站：${asset.title}`}><Trash2 size={15} /></button>}</div>; })}
            </Fragment>)}
            {!visibleAssets.length && !busy ? <EmptyState title="这里还没有文档" detail="上传 Markdown、PDF、Word 或 Excel 开始沉淀。" /> : null}
          </div>
        )}
      </section>

      <ResizeHandle label="调整右侧图谱宽度" onDelta={(delta) => setGraphWidth((current) => Math.min(maxGraphWidth, Math.max(MIN_GRAPH_WIDTH, current - delta)))} onReset={() => setGraphWidth(DEFAULT_GRAPH_WIDTH)} />

      <AssetWorkbench
        workspaceName={active?.name || "Workspace"}
        graph={graph}
        selectedAsset={selectedAsset}
        view={workbenchView}
        onViewChange={setWorkbenchView}
        onSelectNode={selectGraphNode}
        onChanged={async () => { await Promise.all([loadWorkspace(true), refreshWorkspaces()]); }}
        onDelete={setDeleteTarget}
        onManage={setAssetManagerTarget}
        onDownload={async (asset) => { try { await api.downloadAsset(asset.id, asset.title); } catch (reason) { setNotice(reason instanceof Error ? reason.message : "下载失败"); } }}
      />

      {workspaceDialog ? <WorkspaceDialog kind={kind} onClose={() => setWorkspaceDialog(false)} onCreated={async (id) => { await refreshWorkspaces(); setActiveId(id); setWorkspaceDialog(false); }} /> : null}
      <WorkspaceManageDialog open={workspaceManagerOpen} workspace={managedWorkspace} onClose={() => setWorkspaceManagerOpen(false)} onChanged={refreshWorkspaces} />
      {catalogDialog && activeId ? <CatalogDialog type={catalogDialog} workspaceId={activeId} categories={categories} defaultCategoryId={categoryId} onClose={() => setCatalogDialog(null)} onCreated={async () => { const [categoryResult, productResult] = await Promise.all([api.categories(activeId), api.products(activeId)]); setCategories(categoryResult.categories); setProducts(productResult.products); setCatalogDialog(null); }} /> : null}
      {catalogManagerOpen && activeId ? <CatalogManagerDialog workspaceId={activeId} categories={categories} products={products} onClose={() => setCatalogManagerOpen(false)} onChanged={async () => { const [categoryResult, productResult] = await Promise.all([api.categories(activeId), api.products(activeId)]); setCategories(categoryResult.categories); setProducts(productResult.products); }} /> : null}
      {assetManagerTarget ? <AssetManageDialog asset={assetManagerTarget} workspaces={allWorkspaces} onClose={() => setAssetManagerTarget(null)} onChanged={async () => { await Promise.all([loadWorkspace(true), refreshWorkspaces()]); }} /> : null}
      <ConfirmActionDialog open={Boolean(deleteTarget)} danger={deleteTargetIsDeleted} busy={busy} title={deleteTargetIsDeleted ? `永久删除${deleteTarget?.type === "image" ? "图片" : "文档"}` : "移入回收站"} subject={deleteTarget?.title} description={deleteTargetIsDeleted ? "将永久清理原文件和数据库记录，此操作无法撤销。" : "将从检索、图谱和 GBrain 中移除，但保留原文件，可在回收站恢复。"} confirmText={deleteTargetIsDeleted ? "永久删除" : "移入回收站"} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteTarget ? deleteAsset(deleteTarget) : undefined} />
    </main>
  );
}

function groupAssets(assets: Asset[]) {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    const label = relativeAssetDate(asset.updated_at);
    groups.set(label, [...(groups.get(label) || []), asset]);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function relativeAssetDate(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return "最近 30 天";
  return "更早";
}

function formatAssetDate(value: string, locale: AppLocale) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit" }).format(date);
}

function CatalogBar({ categories, products, categoryId, productId, onCategory, onProduct, onCreate, onManage }: {
  categories: Category[];
  products: Product[];
  categoryId: string;
  productId: string;
  onCategory: (id: string) => void;
  onProduct: (id: string) => void;
  onCreate: (type: "category" | "product") => void;
  onManage: () => void;
}) {
  const selectedCategory = categories.find((item) => item.id === categoryId);
  const productOptions = products.filter((item) => !categoryId || item.category_id === categoryId);
  return (
    <div className="catalog-bar">
      <div><FolderTree size={17} /><select value={categoryId} onChange={(event) => onCategory(event.target.value)}><option value="">全部类目</option>{categories.map((category) => <option key={category.id} value={category.id}>{"　".repeat(category.level - 1)}{category.name}</option>)}</select><button className="icon-button" onClick={() => onCreate("category")} title="新建类目"><Plus size={16} /></button></div>
      <div><Boxes size={17} /><select value={productId} onChange={(event) => onProduct(event.target.value)} disabled={!selectedCategory || selectedCategory.level !== 3}><option value="">全部商品</option>{productOptions.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><button className="icon-button" onClick={() => onCreate("product")} disabled={!selectedCategory || selectedCategory.level !== 3} title="新建商品"><PackagePlus size={16} /></button></div>
      <button className="icon-button catalog-manage-button" onClick={onManage} title="管理类目与商品"><Settings2 size={16} /></button>
    </div>
  );
}

function WorkspaceDialog({ kind, onClose, onCreated }: { kind: "document" | "image"; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"personal" | "team">("team");
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.businessUnits().then(({ businessUnits: items }) => { setBusinessUnits(items); setBusinessUnitId(items[0]?.id || ""); }).catch(() => setBusinessUnits([])); }, []);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await api.createWorkspace({ name, description, scope, kind, businessUnitId: scope === "team" ? businessUnitId || null : null });
      onCreated(result.workspace.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  return <EntityModal open title="新建 Workspace" description={kind === "document" ? "沉淀运营文档、策略和 SOP。" : "按类目与商品管理图片素材。"} busy={busy} confirmText="创建 Workspace" confirmDisabled={!name.trim()} onCancel={onClose} onConfirm={submit}><label className="entity-field"><span>名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "document" ? "例如：电商运营知识库" : "例如：电商视觉素材库"} /></label><label className="entity-field"><span>描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明该空间沉淀的知识范围" /></label><div className="segmented-control stretch"><button type="button" className={scope === "personal" ? "active" : ""} onClick={() => setScope("personal")}>个人沉淀</button><button type="button" className={scope === "team" ? "active" : ""} onClick={() => setScope("team")}>团队知识</button></div>{scope === "team" ? <label className="entity-field"><span>业务分区</span><select value={businessUnitId} onChange={(event) => setBusinessUnitId(event.target.value)}>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label> : null}{error ? <p className="form-error">{error}</p> : null}</EntityModal>;
}

function CatalogDialog({ type, workspaceId, categories, defaultCategoryId, onClose, onCreated }: { type: "category" | "product"; workspaceId: string; categories: Category[]; defaultCategoryId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(type === "product" ? defaultCategoryId : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const options = categories.filter((item) => type === "product" ? item.level === 3 : item.level < 3);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (type === "product") await api.createProduct(workspaceId, parentId, name);
      else await api.createCategory(workspaceId, name, parentId || null);
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  return <EntityModal open title={type === "product" ? "新建商品" : "新建类目"} description={type === "product" ? "商品必须归属于三级叶子类目。" : "类目最多支持三级。"} busy={busy} confirmText={type === "product" ? "创建商品" : "创建类目"} confirmDisabled={!name.trim() || (type === "product" && !parentId)} onCancel={onClose} onConfirm={submit}><label className="entity-field"><span>{type === "product" ? "所属三级类目" : "上级类目"}</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">{type === "product" ? "请选择三级类目" : "一级类目"}</option>{options.map((category) => <option key={category.id} value={category.id}>{"　".repeat(category.level - 1)}{category.name}</option>)}</select></label><label className="entity-field"><span>名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>{error ? <p className="form-error">{error}</p> : null}</EntityModal>;
}

function CatalogManagerDialog({ workspaceId, categories, products, onClose, onChanged }: { workspaceId: string; categories: Category[]; products: Product[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [categoryDrafts, setCategoryDrafts] = useState(categories);
  const [productDrafts, setProductDrafts] = useState(products);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setCategoryDrafts(categories), [categories]);
  useEffect(() => setProductDrafts(products), [products]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await action(); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(false); }
  }
  const leafCategories = categoryDrafts.filter((item) => item.level === 3);
  return <EntityModal open width={760} title="管理类目与商品" description="修改名称和排序；商品可移动到其他三级类目。" busy={busy} confirmText="完成" onCancel={onClose} onConfirm={onClose}>
    <section className="catalog-manager-section"><h3>类目</h3><div className="catalog-manager-list">{categoryDrafts.map((category) => <div key={category.id}><span className="catalog-level">L{category.level}</span><input value={category.name} onChange={(event) => setCategoryDrafts((items) => items.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))} /><input className="catalog-order" type="number" min="0" value={category.sort_order ?? 0} onChange={(event) => setCategoryDrafts((items) => items.map((item) => item.id === category.id ? { ...item, sort_order: Number(event.target.value) } : item))} /><button type="button" onClick={() => void run(() => api.updateCategory(workspaceId, category.id, { name: category.name, sortOrder: category.sort_order || 0 }))}>保存</button><button type="button" className="danger" onClick={() => { if (window.confirm(`确认删除空类目“${category.name}”？`)) void run(() => api.deleteCategory(workspaceId, category.id)); }}><Trash2 size={14} /></button></div>)}</div></section>
    <section className="catalog-manager-section"><h3>商品</h3><div className="catalog-manager-list">{productDrafts.map((product) => <div key={product.id}><input value={product.name} onChange={(event) => setProductDrafts((items) => items.map((item) => item.id === product.id ? { ...item, name: event.target.value } : item))} /><select value={product.category_id} onChange={(event) => setProductDrafts((items) => items.map((item) => item.id === product.id ? { ...item, category_id: event.target.value } : item))}>{leafCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input className="catalog-order" type="number" min="0" value={product.sort_order ?? 0} onChange={(event) => setProductDrafts((items) => items.map((item) => item.id === product.id ? { ...item, sort_order: Number(event.target.value) } : item))} /><button type="button" onClick={() => void run(() => api.updateProduct(workspaceId, product.id, { name: product.name, categoryId: product.category_id, sortOrder: product.sort_order || 0 }))}>保存</button><button type="button" className="danger" onClick={() => { if (window.confirm(`确认删除空商品“${product.name}”？`)) void run(() => api.deleteProduct(workspaceId, product.id)); }}><Trash2 size={14} /></button></div>)}</div></section>
    {error ? <p className="form-error">{error}</p> : null}
  </EntityModal>;
}
