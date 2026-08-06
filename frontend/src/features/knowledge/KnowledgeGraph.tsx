import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { FolderTree, Image, Maximize2, Minus, Network, Package, Plus, Search, Tags } from "lucide-react";
import type { GraphEdge, GraphNode } from "../../types/domain";
import { EmptyState } from "../../shared/EmptyState";
import { FileTypeIcon } from "./FileTypeIcon";
import { getDateLocale, useI18n, type AppLocale } from "../../i18n";

interface Point { x: number; y: number }
interface GraphLayout { points: Map<string, Point>; width: number; height: number }

const ringCapacities = [8, 14, 22, 30, 38];

export function layoutGraphNodes(nodes: GraphNode[], locale: AppLocale = getDateLocale()): GraphLayout {
  const points = new Map<string, Point>();
  const center = nodes.find((node) => node.type === "workspace") || nodes[0];
  if (!center) return { points, width: 720, height: 520 };
  const children = nodes
    .filter((node) => node.id !== center.id)
    .sort((left, right) => `${left.type}:${left.label}`.localeCompare(`${right.type}:${right.label}`, locale));
  let remaining = children.length;
  let ringCount = 0;
  while (remaining > 0) {
    remaining -= ringCapacities[Math.min(ringCount, ringCapacities.length - 1)];
    ringCount += 1;
  }
  const outerRing = Math.max(0, ringCount - 1);
  const outerRadiusX = 190 + outerRing * 160;
  const outerRadiusY = 135 + outerRing * 115;
  const width = Math.max(720, outerRadiusX * 2 + 150);
  const height = Math.max(520, outerRadiusY * 2 + 130);
  const origin = { x: width / 2, y: height / 2 };
  points.set(center.id, origin);
  let offset = 0;
  ringCapacities.slice(0, ringCount).forEach((capacity, ring) => {
    const items = children.slice(offset, offset + capacity);
    items.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, items.length) - Math.PI / 2 + ring * 0.12;
      const radiusX = 190 + ring * 160;
      const radiusY = 135 + ring * 115;
      points.set(node.id, { x: origin.x + Math.cos(angle) * radiusX, y: origin.y + Math.sin(angle) * radiusY });
    });
    offset += capacity;
  });
  return { points, width, height };
}

function withinDepth(nodes: GraphNode[], edges: GraphEdge[], depth: number) {
  const center = nodes.find((node) => node.type === "workspace") || nodes[0];
  if (!center) return [];
  const visible = new Set([center.id]);
  let frontier = new Set([center.id]);
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !visible.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !visible.has(edge.source)) next.add(edge.source);
    }
    next.forEach((id) => visible.add(id));
    frontier = next;
  }
  return nodes.filter((node) => visible.has(node.id));
}

export function KnowledgeGraph({ nodes, edges, selectedAssetId, onSelect }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedAssetId?: string;
  onSelect: (node: GraphNode) => void;
}) {
  const { locale } = useI18n();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [depth, setDepth] = useState(3);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const types = useMemo(() => [...new Set(nodes.filter((node) => node.type !== "workspace").map((node) => node.type))].sort(), [nodes]);
  const visibleNodes = useMemo(() => {
    const scoped = withinDepth(nodes, edges, depth);
    const normalized = search.trim().toLocaleLowerCase();
    const center = scoped.find((node) => node.type === "workspace");
    const matches = scoped.filter((node) => node.type !== "workspace" && (type === "all" || node.type === type) && (!normalized || `${node.label} ${node.summary}`.toLocaleLowerCase().includes(normalized)));
    return [...(center ? [center] : []), ...matches].slice(0, 80);
  }, [depth, edges, nodes, search, type]);

  const graphLayout = useMemo(() => layoutGraphNodes(visibleNodes, locale), [locale, visibleNodes]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));

  function fitGraph() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.max(0.55, Math.min(1, (canvas.clientWidth - 36) / graphLayout.width, (canvas.clientHeight - 36) / graphLayout.height));
    setViewport({
      scale,
      x: (canvas.clientWidth - graphLayout.width * scale) / 2,
      y: (canvas.clientHeight - graphLayout.height * scale) / 2
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = window.requestAnimationFrame(fitGraph);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitGraph);
    observer?.observe(canvas);
    if (!observer) window.addEventListener("resize", fitGraph);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", fitGraph);
    };
  }, [graphLayout.height, graphLayout.width]);

  function zoomAt(nextScale: number, clientX?: number, clientY?: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const anchorY = (clientY ?? rect.top + rect.height / 2) - rect.top;
    setViewport((current) => {
      const scale = Math.max(0.45, Math.min(1.5, nextScale));
      const worldX = (anchorX - current.x) / current.scale;
      const worldY = (anchorY - current.y) / current.scale;
      return { scale, x: anchorX - worldX * scale, y: anchorY - worldY * scale };
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomAt(viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({ ...current, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  if (nodes.length < 2) return <EmptyState title="图谱正在等待知识" detail="上传并完成索引后，真实文档、实体、类目和商品会出现在这里。" />;
  return (
    <div className="graph-shell">
      <div className="graph-controls">
        <label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点" /></label>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="节点类型"><option value="all">全部类型</option>{types.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={depth} onChange={(event) => setDepth(Number(event.target.value))} aria-label="关系深度"><option value="1">1 层</option><option value="2">2 层</option><option value="3">3 层</option><option value="4">4 层</option></select>
        <span>{visibleNodes.length - 1} / {nodes.length - 1} 节点</span>
      </div>
      <div ref={canvasRef} className={`graph-canvas ${dragging ? "dragging" : ""}`} aria-label="知识关系图谱" onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
        <div className="graph-world" style={{ width: graphLayout.width, height: graphLayout.height, transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}>
          <svg viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`} aria-hidden="true">
            {edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => {
              const source = graphLayout.points.get(edge.source);
              const target = graphLayout.points.get(edge.target);
              return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y}><title>{`${edge.label}${edge.evidence ? `：${edge.evidence}` : ""}${edge.confidence ? `（${Math.round(edge.confidence * 100)}%）` : ""}`}</title></line> : null;
            })}
          </svg>
          {visibleNodes.map((node) => {
            const point = graphLayout.points.get(node.id);
            if (!point) return null;
            const center = node.type === "workspace";
            const entity = !node.assetId && !center;
            return <button key={node.id} className={`graph-node ${center ? "center" : ""} ${entity ? "entity" : ""} ${selectedAssetId && node.assetId === selectedAssetId ? "selected" : ""}`} data-node-type={node.type} style={{ left: point.x, top: point.y }} onClick={() => onSelect(node)} title={node.summary || node.label}><span className={!center && node.type !== "image" ? "file-node-icon" : ""}>{center ? <Network size={20} /> : node.type === "image" ? <Image size={17} /> : node.type === "product" ? <Package size={17} /> : node.type === "category" ? <FolderTree size={17} /> : entity ? <Tags size={17} /> : <FileTypeIcon format={node.format} title={node.label} compact />}</span><b>{node.label}</b></button>;
          })}
        </div>
        <div className="graph-zoom-tools" aria-label="图谱缩放">
          <button type="button" onClick={() => zoomAt(viewport.scale * 1.15)} title="放大图谱"><Plus size={15} /></button>
          <button type="button" onClick={() => zoomAt(viewport.scale / 1.15)} title="缩小图谱"><Minus size={15} /></button>
          <button type="button" onClick={fitGraph} title="适应画布"><Maximize2 size={15} /></button>
          <span>{Math.round(viewport.scale * 100)}%</span>
        </div>
        <span className="graph-canvas-hint">滚轮缩放 · 拖动画布</span>
      </div>
    </div>
  );
}
