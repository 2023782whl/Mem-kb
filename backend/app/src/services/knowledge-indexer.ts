import { query, tx } from "../db/pool.js";
import type { Asset } from "../db/schema.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { addGBrainLink, putGBrainPage } from "./gbrain.js";
import { extractKnowledgeGraph } from "./model.js";
import { buildMarkdownPage } from "./parser.js";
import { createId } from "../utils/id.js";
import { indexDocumentChunks } from "./document-retrieval.js";

interface EntityInput {
  label: string;
  type: string;
  relation: string;
  evidence: string;
}

interface IndexInput {
  asset: Asset;
  title: string;
  body: string;
  sha256?: string;
  source: string;
  presetTopics?: EntityInput[];
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

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

async function upsertAssetNode(asset: Asset, title: string, summary: string, entities: EntityInput[]) {
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

async function replaceAssetEntities(asset: Asset, entities: EntityInput[]) {
  const normalizedEntities = entities
    .map((entity) => ({ ...entity, normalized: normalizeLabel(entity.label) }))
    .filter((entity) => entity.normalized);
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
     join image_embeddings right_embedding
       on right_embedding.workspace_id = left_embedding.workspace_id
      and right_embedding.asset_id > left_embedding.asset_id
     where left_embedding.tenant_id = $1 and left_embedding.workspace_id = $2
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

export async function rebuildWorkspaceRelations(tenantId: string, workspaceId: string) {
  const nodes = await loadAssetNodes(tenantId, workspaceId);
  const candidates = new Map<string, Relation>();
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      if (left.product_id && left.product_id === right.product_id) {
        addCandidate(candidates, {
          sourceNodeId: left.id, targetNodeId: right.id, sourceAssetId: left.asset_id, targetAssetId: right.asset_id,
          relation: "同一商品", evidence: "关联同一商品资产", source: "explicit", confidence: 1
        });
        continue;
      }
      if (left.category_id && left.category_id === right.category_id) {
        addCandidate(candidates, {
          sourceNodeId: left.id, targetNodeId: right.id, sourceAssetId: left.asset_id, targetAssetId: right.asset_id,
          relation: "同一类目", evidence: "关联同一三级类目", source: "explicit", confidence: 0.95
        });
      }
      const rightLabels = new Set(right.entities.map((entity) => entity.normalizedLabel));
      const shared = left.entities.filter((entity) => rightLabels.has(entity.normalizedLabel));
      if (shared.length) {
        addCandidate(candidates, {
          sourceNodeId: left.id, targetNodeId: right.id, sourceAssetId: left.asset_id, targetAssetId: right.asset_id,
          relation: "共同主题", evidence: `共同实体：${shared.map((entity) => entity.label).slice(0, 4).join("、")}`,
          source: "entity_overlap", confidence: Math.min(0.9, 0.62 + shared.length * 0.08)
        });
      }
    }
  }
  await addSemanticImageRelations(tenantId, workspaceId, nodes, candidates);
  const relations = [...candidates.values()];
  await tx(async (client) => {
    await client.query(`delete from graph_edges where tenant_id = $1 and workspace_id = $2`, [tenantId, workspaceId]);
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
  return relations;
}

export async function indexKnowledgeAsset(input: IndexInput) {
  const extracted = input.presetTopics
    ? {
        summary: input.asset.summary || input.body.replace(/\s+/g, " ").slice(0, 180),
        tags: input.asset.tags || [],
        topics: input.presetTopics
      }
    : await extractKnowledgeGraph(input.title, input.body);
  const entities = extracted.topics.filter((item) => item.label?.trim()).slice(0, 12);
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
  const relations = await rebuildWorkspaceRelations(input.asset.tenant_id, input.asset.workspace_id);
  const nodes = await loadAssetNodes(input.asset.tenant_id, input.asset.workspace_id);
  const nodeByAsset = new Map(nodes.map((node) => [node.asset_id, node]));
  const activeRelations = relations.filter((item) => item.sourceAssetId === input.asset.id || item.targetAssetId === input.asset.id);
  await mapWithConcurrency(activeRelations, 4, async (relation) => {
    const source = nodeByAsset.get(relation.sourceAssetId);
    const target = nodeByAsset.get(relation.targetAssetId);
    if (source?.gbrain_slug && target?.gbrain_slug) {
      await addGBrainLink(source.gbrain_slug, target.gbrain_slug, relation.relation, relation.evidence);
    }
  });
  return { summary: extracted.summary, tags, topics: entities };
}
