import { query, tx } from "../db/pool.js";
import type { Asset } from "../db/schema.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { addGBrainLink, putGBrainPage } from "./gbrain.js";
import { extractKnowledgeGraph } from "./model.js";
import { buildMarkdownPage } from "./parser.js";
import { createId } from "../utils/id.js";
import { indexDocumentChunks } from "./document-retrieval.js";
import { normalizeKnowledgeEntities, type KnowledgeEntityInput } from "./knowledge-entities.js";

interface IndexInput {
  asset: Asset;
  title: string;
  body: string;
  sha256?: string;
  source: string;
  presetTopics?: KnowledgeEntityInput[];
}

interface AssetNodeRow {
  id: string;
  asset_id: string;
  gbrain_slug: string;
  title: string;
  product_id: string | null;
  category_id: string | null;
  entities: Array<{ label: string; normalizedLabel: string }>;
}

interface Relation {
  sourceNodeId: string;
  targetNodeId: string;
  sourceAssetId: string;
  targetAssetId: string;
  relation: string;
  evidence: string;
  source: "explicit" | "entity_overlap" | "semantic";
  confidence: number;
}

async function upsertAssetNode(asset: Asset, title: string, summary: string, entities: KnowledgeEntityInput[]) {
  const rows = await query<{ id: string }>(
    `insert into graph_nodes (id, tenant_id, workspace_id, asset_id, slug, label, node_type, summary, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (workspace_id, slug) do update
     set asset_id = excluded.asset_id, label = excluded.label, node_type = excluded.node_type,
         summary = excluded.summary, metadata = excluded.metadata, updated_at = now()
     returning id`,
    [
      createId("node"), asset.tenant_id, asset.workspace_id, asset.id, asset.gbrain_slug,
      title, asset.type, summary, JSON.stringify({ entities: entities.map((item) => ({ label: item.label, type: item.type })) })
    ]
  );
  return rows[0].id;
}

async function replaceAssetEntities(asset: Asset, entities: KnowledgeEntityInput[]) {
  const normalizedEntities = normalizeKnowledgeEntities(entities);
  await tx(async (client) => {
    await client.query(`delete from asset_entities where asset_id = $1`, [asset.id]);
    if (!normalizedEntities.length) return;
    const values: unknown[] = [];
    const rows = normalizedEntities.map((entity, index) => {
      const offset = index * 8;
      values.push(
        createId("entity"), asset.tenant_id, asset.workspace_id, asset.id,
        entity.label.trim(), entity.normalized, entity.type || "topic", entity.evidence || ""
      );
      return `(${Array.from({ length: 8 }, (_, valueIndex) => `$${offset + valueIndex + 1}`).join(",")})`;
    });
    await client.query(
      `insert into asset_entities
       (id, tenant_id, workspace_id, asset_id, label, normalized_label, entity_type, evidence)
       values ${rows.join(",")}
       on conflict (asset_id, normalized_label, entity_type) do update
       set label = excluded.label, evidence = excluded.evidence, updated_at = now()`,
      values
    );
  });
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function addCandidate(map: Map<string, Relation>, candidate: Relation) {
  const key = pairKey(candidate.sourceNodeId, candidate.targetNodeId);
  const current = map.get(key);
  if (!current || candidate.confidence > current.confidence) map.set(key, candidate);
}

async function loadAssetNodes(tenantId: string, workspaceId: string) {
  return query<AssetNodeRow>(
    `select n.id, a.id as asset_id, a.gbrain_slug, a.title, a.product_id, a.category_id,
            coalesce(jsonb_agg(jsonb_build_object('label', e.label, 'normalizedLabel', e.normalized_label))
              filter (where e.id is not null), '[]'::jsonb) as entities
     from graph_nodes n
     join assets a on a.id = n.asset_id
     left join asset_entities e on e.asset_id = a.id
     where n.tenant_id = $1 and n.workspace_id = $2 and a.deleted_at is null
       and a.status in ('indexing', 'ready')
     group by n.id, a.id, a.gbrain_slug, a.title, a.product_id, a.category_id
     order by a.created_at desc`,
    [tenantId, workspaceId]
  );
}

async function addSemanticImageRelations(tenantId: string, workspaceId: string, nodes: AssetNodeRow[], candidates: Map<string, Relation>) {
  const nodeByAsset = new Map(nodes.map((node) => [node.asset_id, node]));
  const pairs = await query<{ source_asset_id: string; target_asset_id: string; confidence: number }>(
    `select left_embedding.asset_id as source_asset_id, right_embedding.asset_id as target_asset_id,
            (1 - (left_embedding.embedding <=> right_embedding.embedding))::double precision as confidence
     from image_embeddings left_embedding
     cross join lateral (
       select candidate.asset_id, candidate.embedding
       from image_embeddings candidate
       where candidate.tenant_id = left_embedding.tenant_id
         and candidate.workspace_id = left_embedding.workspace_id
         and candidate.asset_id <> left_embedding.asset_id
       order by candidate.embedding <=> left_embedding.embedding
       limit 6
     ) right_embedding
     where left_embedding.tenant_id = $1 and left_embedding.workspace_id = $2
       and left_embedding.asset_id < right_embedding.asset_id
       and (left_embedding.embedding <=> right_embedding.embedding) <= 0.32`,
    [tenantId, workspaceId]
  );
  for (const pair of pairs) {
    const source = nodeByAsset.get(pair.source_asset_id);
    const target = nodeByAsset.get(pair.target_asset_id);
    if (!source || !target) continue;
    addCandidate(candidates, {
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourceAssetId: source.asset_id,
      targetAssetId: target.asset_id,
      relation: "视觉相似",
      evidence: "多模态向量相似",
      source: "semantic",
      confidence: Number(pair.confidence)
    });
  }
}

function addBucketRelations(
  candidates: Map<string, Relation>,
  nodes: AssetNodeRow[],
  relation: Relation["relation"],
  evidence: (left: AssetNodeRow, right: AssetNodeRow) => string,
  source: Relation["source"],
  confidence: number,
  neighbors: number,
  focusAssetId?: string
) {
  if (focusAssetId) {
    const focus = nodes.find((node) => node.asset_id === focusAssetId);
    if (!focus) return;
    nodes.filter((node) => node.asset_id !== focusAssetId).slice(0, neighbors).forEach((target) => addCandidate(candidates, {
      sourceNodeId: focus.id,
      targetNodeId: target.id,
      sourceAssetId: focus.asset_id,
      targetAssetId: target.asset_id,
      relation,
      evidence: evidence(focus, target),
      source,
      confidence
    }));
    return;
  }
  for (let index = 0; index < nodes.length; index += 1) {
    for (let offset = 1; offset <= neighbors && index + offset < nodes.length; offset += 1) {
      const left = nodes[index];
      const right = nodes[index + offset];
      addCandidate(candidates, {
        sourceNodeId: left.id,
        targetNodeId: right.id,
        sourceAssetId: left.asset_id,
        targetAssetId: right.asset_id,
        relation,
        evidence: evidence(left, right),
        source,
        confidence
      });
    }
  }
}

function collectStructuredRelations(nodes: AssetNodeRow[], focusAssetId?: string) {
  const candidates = new Map<string, Relation>();
  const products = new Map<string, AssetNodeRow[]>();
  const categories = new Map<string, AssetNodeRow[]>();
  const entities = new Map<string, { label: string; nodes: AssetNodeRow[] }>();
  for (const node of nodes) {
    if (node.product_id) products.set(node.product_id, [...(products.get(node.product_id) || []), node]);
    if (node.category_id) categories.set(node.category_id, [...(categories.get(node.category_id) || []), node]);
    for (const entity of node.entities) {
      const bucket = entities.get(entity.normalizedLabel) || { label: entity.label, nodes: [] };
      bucket.nodes.push(node);
      entities.set(entity.normalizedLabel, bucket);
    }
  }
  for (const bucket of products.values()) {
    addBucketRelations(candidates, bucket, "同一商品", () => "关联同一商品资产", "explicit", 1, 20, focusAssetId);
  }
  for (const bucket of categories.values()) {
    addBucketRelations(candidates, bucket, "同一类目", () => "关联同一三级类目", "explicit", 0.95, 8, focusAssetId);
  }
  for (const bucket of entities.values()) {
    addBucketRelations(candidates, bucket.nodes, "共同主题", () => `共同实体：${bucket.label}`, "entity_overlap", 0.7, 6, focusAssetId);
  }
  return candidates;
}

async function writeRelations(tenantId: string, workspaceId: string, relations: Relation[], focusNodeId?: string) {
  await tx(async (client) => {
    if (focusNodeId) {
      await client.query(
        `delete from graph_edges where tenant_id = $1 and workspace_id = $2
          and (source_node_id = $3 or target_node_id = $3)`,
        [tenantId, workspaceId, focusNodeId]
      );
    } else {
      await client.query(`delete from graph_edges where tenant_id = $1 and workspace_id = $2`, [tenantId, workspaceId]);
    }
    for (let start = 0; start < relations.length; start += 100) {
      const batch = relations.slice(start, start + 100);
      const values: unknown[] = [];
      const rows = batch.map((relation, index) => {
        const offset = index * 11;
        values.push(
          createId("edge"), tenantId, workspaceId, relation.sourceNodeId, relation.targetNodeId,
          relation.relation, relation.sourceAssetId, relation.evidence, relation.source, relation.confidence,
          JSON.stringify({ sourceAssetId: relation.sourceAssetId, targetAssetId: relation.targetAssetId })
        );
        return `(${Array.from({ length: 11 }, (_, valueIndex) => `$${offset + valueIndex + 1}`).join(",")})`;
      });
      await client.query(
        `insert into graph_edges
         (id, tenant_id, workspace_id, source_node_id, target_node_id, relation, evidence_asset_id,
          evidence, source, confidence, metadata)
         values ${rows.join(",")}`,
        values
      );
    }
  });
}

export async function rebuildWorkspaceRelations(tenantId: string, workspaceId: string) {
  const nodes = await loadAssetNodes(tenantId, workspaceId);
  const candidates = collectStructuredRelations(nodes);
  await addSemanticImageRelations(tenantId, workspaceId, nodes, candidates);
  const relations = [...candidates.values()];
  await writeRelations(tenantId, workspaceId, relations);
  return relations;
}

async function updateAssetRelations(tenantId: string, workspaceId: string, assetId: string) {
  const nodes = await loadAssetNodes(tenantId, workspaceId);
  const focus = nodes.find((node) => node.asset_id === assetId);
  if (!focus) return { relations: [] as Relation[], nodes };
  const candidates = collectStructuredRelations(nodes, assetId);
  await addSemanticImageRelations(tenantId, workspaceId, nodes, candidates);
  const relations = [...candidates.values()].filter((item) => item.sourceAssetId === assetId || item.targetAssetId === assetId);
  await writeRelations(tenantId, workspaceId, relations, focus.id);
  return { relations, nodes };
}

export async function indexKnowledgeAsset(input: IndexInput) {
  const extracted = input.presetTopics
    ? {
        summary: input.asset.summary || input.body.replace(/\s+/g, " ").slice(0, 180),
        tags: input.asset.tags || [],
        topics: input.presetTopics
      }
    : await extractKnowledgeGraph(input.title, input.body, input.asset.tenant_id);
  const entities = normalizeKnowledgeEntities(extracted.topics);
  const tags = [...new Set(extracted.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 5);
  const updateAnalysis = input.presetTopics
    ? Promise.resolve()
    : query(
      `update assets
       set summary = $1, tags = $2,
           metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       where id = $4`,
      [
        extracted.summary,
        tags,
        JSON.stringify({
          analysis: {
            provider: "llm",
            version: "document-analysis-v2",
            generatedAt: new Date().toISOString()
          }
        }),
        input.asset.id
      ]
    ).then(() => undefined);
  const markdown = buildMarkdownPage({
    title: input.title,
    body: input.body,
    tenantId: input.asset.tenant_id,
    workspaceId: input.asset.workspace_id,
    assetId: input.asset.id,
    source: input.source,
    sha256: input.sha256
  });
  await Promise.all([
    updateAnalysis,
    putGBrainPage(input.asset.gbrain_slug!, markdown),
    input.asset.type === "image" ? Promise.resolve() : indexDocumentChunks(input.asset, input.body),
    upsertAssetNode(input.asset, input.title, extracted.summary || input.asset.summary || "", entities),
    replaceAssetEntities(input.asset, entities)
  ]);
  const { relations, nodes } = await updateAssetRelations(input.asset.tenant_id, input.asset.workspace_id, input.asset.id);
  const nodeByAsset = new Map(nodes.map((node) => [node.asset_id, node]));
  await mapWithConcurrency(relations, 4, async (relation) => {
    const source = nodeByAsset.get(relation.sourceAssetId);
    const target = nodeByAsset.get(relation.targetAssetId);
    if (source?.gbrain_slug && target?.gbrain_slug) {
      await addGBrainLink(source.gbrain_slug, target.gbrain_slug, relation.relation, relation.evidence);
    }
  });
  return { summary: extracted.summary, tags, topics: entities };
}
