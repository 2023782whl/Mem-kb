import crypto from "node:crypto";
import { env } from "../config/env.js";
import { query, tx } from "../db/pool.js";
import type { Asset } from "../db/schema.js";
import { embedTexts, rerankDocuments } from "../providers/retrieval.js";
import { vectorLiteral } from "../providers/embedding.js";
import { createId } from "../utils/id.js";
import { Singleflight } from "../utils/singleflight.js";
import { chunkMarkdown } from "./document-chunker.js";

interface CandidateRow {
  id: string;
  workspace_id: string;
  asset_id: string;
  chunk_index: number;
  heading: string;
  content: string;
  title: string;
  gbrain_slug: string | null;
  score: number;
}

interface StoredEmbeddingRow {
  content_hash: string;
  embedding: string;
}

interface QueryEmbeddingRow {
  embedding: string;
}

interface RetrievalCacheRow {
  results: DocumentHit[];
}

export interface DocumentHit {
  chunkId: string;
  workspaceId: string;
  assetId: string;
  title: string;
  heading: string;
  content: string;
  slug: string | null;
  score: number;
}

const embeddingFlights = new Singleflight<number[]>();
const retrievalFlights = new Singleflight<DocumentHit[]>();

export async function indexDocumentChunks(asset: Asset, markdown: string) {
  const chunks = chunkMarkdown(markdown);
  if (!chunks.length) throw new Error("文档没有可索引内容");
  const existing = await query<StoredEmbeddingRow>(
    `select content_hash, embedding::text as embedding
     from document_chunks where asset_id = $1 and model_id = $2`,
    [asset.id, env.retrieval.embeddingModelId]
  );
  const storedVectors = new Map(existing.map((row) => [row.content_hash, JSON.parse(row.embedding) as number[]]));
  const missingChunks = chunks.filter((chunk) => !storedVectors.has(chunk.hash));
  const missingVectors = await embedTexts(missingChunks.map((chunk) => `${asset.title}\n${chunk.heading}\n${chunk.content}`));
  const generatedVectors = new Map(missingChunks.map((chunk, index) => [chunk.hash, missingVectors[index]]));

  await tx(async (client) => {
    await client.query(`delete from document_chunks where asset_id = $1`, [asset.id]);
    await client.query(`delete from retrieval_result_cache where tenant_id = $1 and workspace_id = $2`, [asset.tenant_id, asset.workspace_id]);
    await client.query(
      `delete from retrieval_scope_cache where tenant_id = $1 and $2 = any(workspace_ids)`,
      [asset.tenant_id, asset.workspace_id]
    );
    for (let offset = 0; offset < chunks.length; offset += 100) {
      const batch = chunks.slice(offset, offset + 100);
      const values: unknown[] = [];
      const rows = batch.map((chunk, index) => {
        const vector = storedVectors.get(chunk.hash) || generatedVectors.get(chunk.hash);
        if (!vector) throw new Error(`分块向量缺失：${chunk.index}`);
        const base = index * 10;
        values.push(createId("chunk"), asset.tenant_id, asset.workspace_id, asset.id, chunk.index, chunk.heading, chunk.content, chunk.hash, env.retrieval.embeddingModelId, vectorLiteral(vector));
        return `(${Array.from({ length: 9 }, (_, valueIndex) => `$${base + valueIndex + 1}`).join(",")},$${base + 10}::vector)`;
      });
      await client.query(
        `insert into document_chunks
         (id, tenant_id, workspace_id, asset_id, chunk_index, heading, content, content_hash, model_id, embedding)
         values ${rows.join(",")}`,
        values
      );
    }
  });
  return chunks.length;
}

function queryHash(searchText: string) {
  const normalized = searchText.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function normalizeWorkspaceIds(workspaceIds: string | string[]) {
  return [...new Set(Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])].filter(Boolean).sort();
}

function scopeHash(workspaceIds: string[]) {
  return crypto.createHash("sha256").update(workspaceIds.join("\n")).digest("hex");
}

function fuse(vectorRows: CandidateRow[], lexicalRows: CandidateRow[]) {
  const fused = new Map<string, CandidateRow & { rrf: number }>();
  const add = (rows: CandidateRow[], weight: number) => rows.forEach((row, index) => {
    const current = fused.get(row.id) || { ...row, rrf: 0 };
    current.rrf += weight / (60 + index + 1);
    current.score = Math.max(current.score, Number(row.score));
    fused.set(row.id, current);
  });
  add(vectorRows, 1);
  add(lexicalRows, 0.85);
  return [...fused.values()].sort((left, right) => right.rrf - left.rrf);
}

async function getQueryEmbedding(tenantId: string, searchText: string) {
  const hash = queryHash(searchText);
  const cached = await query<QueryEmbeddingRow>(
    `update query_embedding_cache_v2 set last_used_at = now()
     where tenant_id = $1 and query_hash = $2 and model_id = $3
     returning embedding::text as embedding`,
    [tenantId, hash, env.retrieval.embeddingModelId]
  );
  if (cached[0]) return JSON.parse(cached[0].embedding) as number[];
  return embeddingFlights.run(`${tenantId}:${env.retrieval.embeddingModelId}:${hash}`, async () => {
    const [embedding] = await embedTexts([searchText]);
    await query(
      `insert into query_embedding_cache_v2 (tenant_id, query_hash, model_id, embedding)
       values ($1,$2,$3,$4::vector)
       on conflict (tenant_id, query_hash, model_id)
       do update set embedding = excluded.embedding, last_used_at = now()`,
      [tenantId, hash, env.retrieval.embeddingModelId, vectorLiteral(embedding)]
    );
    return embedding;
  });
}

function balancedCandidates(candidates: Array<CandidateRow & { rrf: number }>, workspaceIds: string[], limit: number) {
  if (workspaceIds.length === 1) return candidates.slice(0, limit);
  const selected = new Map<string, CandidateRow & { rrf: number }>();
  for (const workspaceId of workspaceIds) {
    candidates.filter((row) => row.workspace_id === workspaceId).slice(0, 2).forEach((row) => selected.set(row.id, row));
  }
  for (const row of candidates) {
    if (selected.size >= limit) break;
    selected.set(row.id, row);
  }
  return [...selected.values()].slice(0, limit);
}

async function saveRetrievalCache(tenantId: string, scope: string, workspaceIds: string[], hash: string, hits: DocumentHit[]) {
  await query(
    `insert into retrieval_scope_cache
     (tenant_id, scope_hash, workspace_ids, query_hash, embedding_model_id, reranker_model_id, results, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,now() + ($8 * interval '1 second'))
     on conflict (tenant_id, scope_hash, query_hash, embedding_model_id, reranker_model_id)
     do update set results = excluded.results, expires_at = excluded.expires_at, created_at = now()`,
    [tenantId, scope, workspaceIds, hash, env.retrieval.embeddingModelId, env.retrieval.rerankerModelId, JSON.stringify(hits), env.retrieval.cacheTtlSeconds]
  );
}

export async function retrieveDocumentKnowledge(tenantId: string, requestedWorkspaceIds: string | string[], searchText: string): Promise<DocumentHit[]> {
  const workspaceIds = normalizeWorkspaceIds(requestedWorkspaceIds);
  if (!workspaceIds.length) return [];
  const hash = queryHash(searchText);
  const scope = scopeHash(workspaceIds);
  const cached = await query<RetrievalCacheRow>(
    `select results from retrieval_scope_cache
     where tenant_id = $1 and scope_hash = $2 and query_hash = $3
       and embedding_model_id = $4 and reranker_model_id = $5 and expires_at > now()`,
    [tenantId, scope, hash, env.retrieval.embeddingModelId, env.retrieval.rerankerModelId]
  );
  if (cached[0]) return cached[0].results;
  const flightKey = `${tenantId}:${scope}:${hash}:${env.retrieval.embeddingModelId}:${env.retrieval.rerankerModelId}`;
  return retrievalFlights.run(flightKey, async () => {
    const candidateLimit = env.retrieval.candidateLimit * Math.min(workspaceIds.length, 4);
    const lexicalPromise = query<CandidateRow>(
    `select c.id, c.workspace_id, c.asset_id, c.chunk_index, c.heading, c.content, a.title, a.gbrain_slug,
            greatest(similarity(c.content, $3), similarity(a.title, $3))::double precision as score
     from document_chunks c join assets a on a.id = c.asset_id
     where c.tenant_id = $1 and c.workspace_id = any($2::text[]) and a.deleted_at is null and a.status = 'ready'
       and (c.content % $3 or a.title % $3 or c.content ilike '%' || $3 || '%' or a.title ilike '%' || $3 || '%')
     order by score desc limit $4`,
    [tenantId, workspaceIds, searchText, candidateLimit]
  );
    const vectorPromise = getQueryEmbedding(tenantId, searchText).then((embedding) => query<CandidateRow>(
    `select c.id, c.workspace_id, c.asset_id, c.chunk_index, c.heading, c.content, a.title, a.gbrain_slug,
            (1 - (c.embedding <=> $3::vector))::double precision as score
     from document_chunks c join assets a on a.id = c.asset_id
     where c.tenant_id = $1 and c.workspace_id = any($2::text[]) and a.deleted_at is null and a.status = 'ready'
       and (1 - (c.embedding <=> $3::vector)) >= $5
     order by c.embedding <=> $3::vector limit $4`,
    [tenantId, workspaceIds, vectorLiteral(embedding), candidateLimit, env.retrieval.minSimilarityThreshold]
  )).catch(() => [] as CandidateRow[]);
    const [lexicalRows, vectorRows] = await Promise.all([lexicalPromise, vectorPromise]);
    const candidates = balancedCandidates(fuse(vectorRows, lexicalRows), workspaceIds, env.retrieval.rerankInputLimit);
    if (!candidates.length) {
      await saveRetrievalCache(tenantId, scope, workspaceIds, hash, []);
      return [];
    }

    let ranked = candidates.map((row, index) => ({ index, score: row.rrf }));
    try {
      ranked = await rerankDocuments(searchText, candidates.map((row) => `${row.title}\n${row.heading}\n${row.content}`), env.retrieval.resultLimit);
    } catch {
      ranked = ranked.slice(0, env.retrieval.resultLimit);
    }

    const perAsset = new Map<string, number>();
    const perWorkspace = new Map<string, number>();
    const workspaceCap = workspaceIds.length > 1 ? Math.max(2, Math.ceil(env.retrieval.resultLimit * 0.6)) : env.retrieval.resultLimit;
    const hits: DocumentHit[] = [];
    for (const item of ranked) {
      const row = candidates[item.index];
      if (!row || (perAsset.get(row.asset_id) || 0) >= 2 || (perWorkspace.get(row.workspace_id) || 0) >= workspaceCap) continue;
      perAsset.set(row.asset_id, (perAsset.get(row.asset_id) || 0) + 1);
      perWorkspace.set(row.workspace_id, (perWorkspace.get(row.workspace_id) || 0) + 1);
      hits.push({ chunkId: row.id, workspaceId: row.workspace_id, assetId: row.asset_id, title: row.title, heading: row.heading, content: row.content, slug: row.gbrain_slug, score: item.score });
      if (hits.length >= env.retrieval.resultLimit) break;
    }
    await saveRetrievalCache(tenantId, scope, workspaceIds, hash, hits);
    return hits;
  });
}
