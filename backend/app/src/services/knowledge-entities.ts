export interface KnowledgeEntityInput {
  label: string;
  type: string;
  relation: string;
  evidence: string;
}

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizeKnowledgeEntities(entities: KnowledgeEntityInput[], limit = 12) {
  const unique = new Map<string, KnowledgeEntityInput & { normalized: string }>();
  for (const entity of entities) {
    const normalized = normalizeLabel(entity.label || "");
    const type = entity.type?.trim() || "topic";
    if (!normalized) continue;
    const key = `${normalized}\u0000${type.toLocaleLowerCase()}`;
    if (!unique.has(key)) unique.set(key, { ...entity, label: entity.label.trim(), type, normalized });
  }
  return [...unique.values()].slice(0, limit);
}
