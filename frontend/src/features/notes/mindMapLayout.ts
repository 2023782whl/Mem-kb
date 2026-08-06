import type { DocumentTreeNode } from "./documentTree";

export const MIND_MAP_COLORS = ["#f4774c", "#f3a52b", "#a6bc28", "#10a0b6", "#6773c8", "#a45fae", "#d85f86", "#2b9b72"];
export type MindMapDirection = "both" | "left" | "right";

export interface MindMapNode extends DocumentTreeNode {
  x: number;
  y: number;
  side: "root" | "left" | "right";
  visualKind: "root" | "topic" | "detail" | "badge";
  branchColor: string;
  branchIndex: number;
  childCount: number;
  collapsed: boolean;
}

export interface MindMapEdge {
  id: string;
  source: string;
  target: string;
  side: "left" | "right";
  branchColor: string;
  level: number;
  controlPointDistances: number[];
  controlPointWeights: number[];
}

export function createMindMapLayout(nodes: DocumentTreeNode[], collapsed: Set<string>, direction: MindMapDirection = "both") {
  if (!nodes.length) return { nodes: [] as MindMapNode[], edges: [] as MindMapEdge[] };
  const root = nodes[0];
  const children = new Map<string, DocumentTreeNode[]>();
  nodes.slice(1).forEach((node) => {
    const siblings = children.get(node.parentId || root.id) || [];
    siblings.push(node);
    children.set(node.parentId || root.id, siblings);
  });
  const topics = children.get(root.id) || [];
  const visualNodes: MindMapNode[] = [{
    ...root, x: 0, y: 0, side: "root", visualKind: "root", branchColor: "#26336b",
    branchIndex: 0, childCount: topics.length, collapsed: collapsed.has(root.id)
  }];
  const edges: MindMapEdge[] = [];
  const positions = new Map([[root.id, { x: 0, y: 0 }]]);

  const leafWeight = (node: DocumentTreeNode): number => {
    const nested = children.get(node.id) || [];
    return nested.length ? nested.reduce((total, child) => total + leafWeight(child), 0) : 1;
  };

  const placeSide = (sideTopics: DocumentTreeNode[], side: "left" | "right", topicOffset: number) => {
    const oneSided = direction !== "both";
    const gap = oneSided ? 22 : 44;
    const spans = sideTopics.map((topic) => Math.max(oneSided ? 58 : 88, leafWeight(topic) * (oneSided ? 48 : 56)));
    const total = spans.reduce((sum, span) => sum + span, 0) + Math.max(0, spans.length - 1) * gap;
    let cursor = -total / 2;

    sideTopics.forEach((topic, localIndex) => {
      const branchIndex = topicOffset + localIndex + 1;
      const branchColor = MIND_MAP_COLORS[(branchIndex - 1) % MIND_MAP_COLORS.length];
      const place = (node: DocumentTreeNode, level: number, top: number, span: number) => {
        const nested = children.get(node.id) || [];
        const y = top + span / 2;
        const x = (side === "right" ? 1 : -1) * (460 + (level - 1) * 260);
        visualNodes.push({
          ...node, x, y, side, visualKind: level === 1 ? "topic" : "detail", branchColor,
          branchIndex, childCount: nested.length, collapsed: collapsed.has(node.id)
        });
        const sourceId = node.parentId || root.id;
        const source = positions.get(sourceId) || { x: 0, y: 0 };
        const controls = bezierControls(source, { x, y });
        positions.set(node.id, { x, y });
        edges.push({
          id: `edge-${node.id}`,
          source: sourceId,
          target: node.id,
          side,
          branchColor,
          level,
          ...controls
        });
        if (level === 1) {
          visualNodes.push({
            ...node, id: `badge-${node.id}`, parentId: null, label: String(branchIndex), note: "", resources: [],
            x: x - (side === "right" ? 152 : -152), y, side, visualKind: "badge", branchColor,
            branchIndex, childCount: 0, collapsed: false
          });
        }
        if (!nested.length || collapsed.has(node.id)) return;
        let childCursor = top;
        const childWeights = nested.map(leafWeight);
        const weightTotal = childWeights.reduce((sum, weight) => sum + weight, 0);
        nested.forEach((child, index) => {
          const childSpan = span * (childWeights[index] / weightTotal);
          place(child, level + 1, childCursor, childSpan);
          childCursor += childSpan;
        });
      };

      place(topic, 1, cursor, spans[localIndex]);
      cursor += spans[localIndex] + gap;
    });
  };

  if (direction === "right") placeSide(topics, "right", 0);
  else if (direction === "left") placeSide(topics, "left", 0);
  else {
    const rightCount = Math.ceil(topics.length / 2);
    placeSide(topics.slice(0, rightCount), "right", 0);
    placeSide(topics.slice(rightCount), "left", rightCount);
  }
  return { nodes: visualNodes, edges };
}

function bezierControls(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const lengthSquared = length * length;
  const first = .5;
  const second = .5;
  return {
    controlPointDistances: [
      -first * dx * dy / length,
      (1 - second) * dx * dy / length
    ],
    controlPointWeights: [
      first * dx * dx / lengthSquared,
      (second * dx * dx + dy * dy) / lengthSquared
    ]
  };
}
