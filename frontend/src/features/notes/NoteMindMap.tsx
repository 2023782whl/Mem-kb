import cytoscape, { type Core } from "cytoscape";
import { ChevronsUp, Download, Focus, LocateFixed, MoreHorizontal, Search, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildDocumentTree, collapsedAtDepth, visibleDocumentTree } from "./documentTree";
import { createMindMapLayout, type MindMapDirection } from "./mindMapLayout";

type DepthPreset = "custom" | "1" | "2" | "3" | "all";

export function NoteMindMap({ title, markdown, compact = false }: { title: string; markdown: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const tree = useMemo(() => buildDocumentTree(title, markdown), [markdown, title]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<MindMapDirection>("right");
  const [depthPreset, setDepthPreset] = useState<DepthPreset>("all");
  const visible = useMemo(() => visibleDocumentTree(tree, collapsed), [collapsed, tree]);
  const layout = useMemo(() => createMindMapLayout(visible, collapsed, direction), [collapsed, direction, visible]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...layout.nodes.map((node) => ({ data: {
          id: node.id, label: node.collapsed && node.childCount ? `${node.label}  +${node.childCount}` : node.label,
          kind: node.visualKind, side: node.side, branchColor: node.branchColor, branchIndex: node.branchIndex,
          childCount: node.childCount, x: node.x, y: node.y
        }, position: { x: node.x, y: node.y } })),
        ...layout.edges.map((edge) => ({ data: edge }))
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "font-family": "Inter, PingFang SC, sans-serif", "font-size": 13, color: "#303746", "text-wrap": "wrap", "text-max-width": "240px", "overlay-opacity": 0, "background-opacity": 0, "border-width": 0, width: 4, height: 4 } },
        { selector: 'node[kind = "root"]', style: { width: 348, height: 84, shape: "round-rectangle", "background-color": "#ffffff", "background-opacity": 1, "border-color": "#26336b", "border-width": 3, color: "#26336b", "font-size": 23, "font-weight": 700, "text-halign": "center", "text-valign": "center", "text-max-width": "290px", "underlay-color": "#26336b", "underlay-opacity": .08, "underlay-padding": 12 } },
        { selector: 'node[kind = "topic"]', style: { "font-size": 16, "font-weight": 700, color: "#20242c", "text-max-width": "224px" } },
        { selector: 'node[kind = "detail"]', style: { "font-size": 12, "font-weight": 500, "text-max-width": "214px" } },
        { selector: 'node[kind = "badge"]', style: { width: 24, height: 24, shape: "ellipse", "background-color": "data(branchColor)", "background-opacity": 1, color: "#ffffff", "font-size": 11, "font-weight": 700, "text-valign": "center", "text-halign": "center", events: "no" } },
        { selector: 'node[side = "right"][kind != "root"][kind != "badge"]', style: { "text-halign": "left", "text-margin-x": 10 } },
        { selector: 'node[side = "left"][kind != "root"][kind != "badge"]', style: { "text-halign": "right", "text-margin-x": -10 } },
        { selector: "node.search-match", style: { "text-background-color": "#f5f2ff", "text-background-opacity": 1, "text-background-padding": "7px", "text-border-color": "#6e5dc6", "text-border-width": 1, "text-border-opacity": .7 } },
        { selector: "edge", style: {
          width: 2.4,
          "line-color": "data(branchColor)",
          "curve-style": "unbundled-bezier",
          "control-point-distances": (edge) => edge.data("controlPointDistances") as number[],
          "control-point-weights": (edge) => edge.data("controlPointWeights") as number[],
          "edge-distances": "node-position",
          "line-cap": "round",
          "target-arrow-shape": "none",
          "overlay-opacity": 0
        } },
        { selector: 'edge[level = 1]', style: { width: 6 } },
        { selector: 'edge[level = 2]', style: { width: 3.2 } }
      ],
      minZoom: .18,
      maxZoom: 2.4,
      layout: { name: "preset", fit: false }
    });
    cy.on("tap", "node", (event) => {
      const id = event.target.id();
      if (!tree.some((node) => node.parentId === id)) return;
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setDepthPreset("custom");
    });
    cyRef.current = cy;
    const frame = window.requestAnimationFrame(() => fitMindMap(cy, compact));
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => fitMindMap(cy, compact));
    });
    observer.observe(containerRef.current);
    return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(resizeFrame); observer.disconnect(); cy.destroy(); cyRef.current = null; };
  }, [compact, layout, tree]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("search-match");
    const term = search.trim().toLocaleLowerCase();
    if (!term) { fitMindMap(cy, compact); return; }
    const matches = cy.nodes('[kind != "badge"]').filter((node) => String(node.data("label")).toLocaleLowerCase().includes(term));
    matches.addClass("search-match");
    if (matches.length) cy.animate({ fit: { eles: matches, padding: 120 }, duration: 220 });
  }, [compact, search]);

  function exportPng() {
    const cy = cyRef.current;
    if (cy) download(cy.png({ full: true, scale: 2, bg: "#ffffff" }), `${title || "笔记导图"}.png`);
  }

  function exportSvg() {
    const cy = cyRef.current;
    if (cy) download(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSvg(cy))}`, `${title || "笔记导图"}.svg`);
  }

  function setExpandedDepth(value: DepthPreset) {
    setDepthPreset(value);
    if (value === "custom") return;
    setCollapsed(value === "all" ? new Set() : collapsedAtDepth(tree, Number(value)));
  }

  function collapseAll() {
    setDepthPreset("custom");
    setCollapsed(new Set([tree[0]?.id].filter(Boolean)));
  }

  return (
    <section className={`note-mindmap ${compact ? "compact" : ""}`}>
      <div className="mindmap-toolbar">
        <div className="mindmap-identity"><i><Waypoints /></i><span><strong>导图</strong><em>{visible.length} 个节点</em></span></div>
        <label className="mindmap-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点" /></label>
        <div className="mindmap-toolbar-actions">
          <select aria-label="导图方向" value={direction} onChange={(event) => setDirection(event.target.value as MindMapDirection)}>
            <option value="both">双边</option>
            <option value="left">仅左侧</option>
            <option value="right">仅右侧</option>
          </select>
          <select aria-label="展开层级" value={depthPreset} onChange={(event) => setExpandedDepth(event.target.value as DepthPreset)}>
            {depthPreset === "custom" ? <option value="custom">自定义</option> : null}
            <option value="1">展开 1 级</option>
            <option value="2">展开 2 级</option>
            <option value="3">展开 3 级</option>
            <option value="all">展开全部</option>
          </select>
          <button className="icon-only" onClick={collapseAll} title="收起全部" aria-label="收起全部"><ChevronsUp /></button>
          <button className="icon-only" onClick={() => fitMindMap(cyRef.current, compact)} title="适应画布" aria-label="适应画布"><Focus /></button>
          <details className="mindmap-more">
            <summary title="更多" aria-label="更多导图操作"><MoreHorizontal /></summary>
            <div>
              <button onClick={() => focusRoot(cyRef.current, compact)}><LocateFixed />定位中心节点</button>
              <button onClick={exportPng}><Download />导出 PNG</button>
              <button onClick={exportSvg}><Download />导出 SVG</button>
            </div>
          </details>
        </div>
      </div>
      <div ref={containerRef} className="mindmap-canvas" aria-label="笔记思维导图" />
    </section>
  );
}

function fitMindMap(cy: Core | null, compact: boolean) {
  if (!cy || cy.destroyed() || !cy.elements().length) return;
  cy.stop();
  cy.resize();
  const container = cy.container();
  const shortestSide = Math.min(container?.clientWidth || 0, container?.clientHeight || 0);
  const padding = compact ? 34 : Math.max(48, Math.min(88, shortestSide * .08));
  cy.fit(cy.elements(), padding);
}

function focusRoot(cy: Core | null, compact: boolean) {
  if (!cy) return;
  const root = cy.nodes('[kind = "root"]');
  cy.zoom(compact ? .72 : .9);
  cy.center(root);
}

function renderSvg(cy: Core) {
  const box = cy.elements().boundingBox();
  const padding = 64;
  const width = Math.max(1, box.w + padding * 2);
  const height = Math.max(1, box.h + padding * 2);
  const viewBox = `${box.x1 - padding} ${box.y1 - padding} ${width} ${height}`;
  const edges = cy.edges().map((edge) => {
    const source = edge.source().position();
    const target = edge.target().position();
    const middle = (source.x + target.x) / 2;
    const stroke = String(edge.data("branchColor"));
    const strokeWidth = edge.data("level") === 1 ? 6 : edge.data("level") === 2 ? 3.2 : 2.4;
    return `<path d="M ${source.x} ${source.y} C ${middle} ${source.y}, ${middle} ${target.y}, ${target.x} ${target.y}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
  }).join("");
  const nodes = cy.nodes().map((node) => {
    const { x, y } = node.position();
    const kind = String(node.data("kind"));
    const label = escapeXml(ellipsis(String(node.data("label") || ""), kind === "root" ? 34 : 30));
    if (kind === "root") return `<g><rect x="${x - 174}" y="${y - 42}" width="348" height="84" rx="38" fill="#fff" stroke="#26336b" stroke-width="3"/><text x="${x}" y="${y + 8}" text-anchor="middle" fill="#26336b" font-family="Inter, PingFang SC, sans-serif" font-size="23" font-weight="700">${label}</text></g>`;
    if (kind === "badge") return `<g><circle cx="${x}" cy="${y}" r="12" fill="${node.data("branchColor")}"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif" font-size="11" font-weight="700">${label}</text></g>`;
    const side = node.data("side") === "left" ? "left" : "right";
    const anchor = side === "left" ? "end" : "start";
    const textX = x + (side === "left" ? 108 : -108);
    const fontSize = kind === "topic" ? 16 : 12;
    const weight = kind === "topic" ? 700 : 500;
    return `<text x="${textX}" y="${y + 5}" text-anchor="${anchor}" fill="#252a35" font-family="Inter, PingFang SC, sans-serif" font-size="${fontSize}" font-weight="${weight}">${label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}"><rect x="${box.x1 - padding}" y="${box.y1 - padding}" width="${width}" height="${height}" rx="24" fill="#fff"/>${edges}${nodes}</svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function ellipsis(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function download(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
