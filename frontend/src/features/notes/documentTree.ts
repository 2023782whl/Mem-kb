export type DocumentNodeKind = "document" | "heading" | "list";

export interface DocumentTreeNode {
  id: string;
  parentId: string | null;
  label: string;
  kind: DocumentNodeKind;
  depth: number;
  note: string;
  resources: string[];
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `node-${(hash >>> 0).toString(36)}`;
}

export function buildDocumentTree(title: string, markdown: string): DocumentTreeNode[] {
  const root: DocumentTreeNode = { id: stableId(`root:${title}`), parentId: null, label: title || "无标题笔记", kind: "document", depth: 0, note: "", resources: [] };
  const nodes = [root];
  const headings: DocumentTreeNode[] = [root];
  const duplicateCount = new Map<string, number>();
  let current = root;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const list = rawLine.match(/^(\s*)(?:[-*+] |\d+[.)]\s+)(.+)$/);
    if (heading) {
      const depth = heading[1].length;
      const label = cleanLabel(heading[2]);
      if (!label || /^第\s*\d+\s*页$/i.test(label)) {
        current = root;
        headings[depth] = root;
        headings.length = depth + 1;
        continue;
      }
      while (headings.length > depth) headings.pop();
      const parent = headings[depth - 1] || root;
      const key = `${parent.id}:${label}:${depth}`;
      const occurrence = (duplicateCount.get(key) || 0) + 1;
      duplicateCount.set(key, occurrence);
      current = { id: stableId(`${key}:${occurrence}`), parentId: parent.id, label, kind: "heading", depth, note: "", resources: [] };
      nodes.push(current);
      headings[depth] = current;
      headings.length = depth + 1;
      continue;
    }
    if (list) {
      const indent = Math.floor(list[1].replace(/\t/g, "  ").length / 2);
      const label = cleanLabel(list[2]);
      if (!label) continue;
      const parent = [...nodes].reverse().find((node) => node.kind === "list" && node.depth === current.depth + indent) || current;
      const key = `${parent.id}:list:${label}`;
      const occurrence = (duplicateCount.get(key) || 0) + 1;
      duplicateCount.set(key, occurrence);
      nodes.push({ id: stableId(`${key}:${occurrence}`), parentId: parent.id, label, kind: "list", depth: parent.depth + 1, note: "", resources: [] });
      continue;
    }
    const images = [...line.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1]);
    if (images.length) current.resources.push(...images);
    const plain = line.replace(/!\[[^\]]*]\([^)]+\)/g, "").trim();
    if (plain) current.note = [current.note, plain].filter(Boolean).join("\n");
  }
  return nodes;
}

function cleanLabel(value: string) {
  const label = value.replace(/[*_`~]/g, "").replace(/^[-—–·、，。；：,.!?！？\s]+|[-—–·、，。；：,.!?！？\s]+$/g, "").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(label) ? label : "";
}

export function visibleDocumentTree(nodes: DocumentTreeNode[], collapsed: Set<string>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => {
    let parentId = node.parentId;
    while (parentId) {
      if (collapsed.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId || null;
    }
    return true;
  });
}

export function collapsedAtDepth(nodes: DocumentTreeNode[], depth: number) {
  if (depth < 1 || !nodes.length) return new Set<string>();
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const parents = new Set(nodes.map((node) => node.parentId).filter(Boolean));
  const levels = new Map<string, number>([[nodes[0].id, 0]]);

  const levelOf = (id: string): number => {
    const known = levels.get(id);
    if (known !== undefined) return known;
    const parentId = parentById.get(id);
    const level = parentId ? levelOf(parentId) + 1 : 0;
    levels.set(id, level);
    return level;
  };

  return new Set(nodes.filter((node) => parents.has(node.id) && levelOf(node.id) === depth).map((node) => node.id));
}
