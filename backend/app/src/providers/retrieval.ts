import { env } from "../config/env.js";
import { findModel, type RuntimeModel } from "../config/models.js";

interface EmbeddingPayload {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
  message?: string;
}

interface RerankPayload {
  results?: Array<{ index: number; relevance_score: number }>;
  error?: { message?: string };
  message?: string;
}

function configuredModel(id: string, kind: RuntimeModel["kind"]) {
  const model = findModel(env.model.models, id);
  if (!model || model.kind !== kind) throw new Error(`模型配置不存在：${id}`);
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) throw new Error(`缺少模型密钥环境变量：${model.apiKeyEnv}`);
  return { model, apiKey };
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export async function embedTexts(texts: string[]) {
  if (!texts.length) return [];
  if (env.model.mode === "mock") {
    return texts.map((text) => Array.from({ length: env.retrieval.embeddingDimensions }, (_, index) => ((text.charCodeAt(index % Math.max(text.length, 1)) || 0) % 97) / 97));
  }
  const { model, apiKey } = configuredModel(env.retrieval.embeddingModelId, "EMBEDDING");
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += 10) {
    const input = texts.slice(offset, offset + 10).map((text) => text.slice(0, 8_000));
    const response = await fetch(endpoint(model.baseUrl, "/embeddings"), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.modelName, input, dimensions: env.retrieval.embeddingDimensions }),
      signal: AbortSignal.timeout(60_000)
    });
    const payload = (await response.json().catch(() => ({}))) as EmbeddingPayload;
    const batch = (payload.data || []).sort((left, right) => (left.index || 0) - (right.index || 0)).map((item) => item.embedding || []);
    if (!response.ok || batch.length !== input.length) throw new Error(payload.error?.message || payload.message || "文本向量生成失败");
    for (const vector of batch) {
      if (vector.length !== env.retrieval.embeddingDimensions) throw new Error(`向量维度不匹配：${vector.length}`);
      vectors.push(vector);
    }
  }
  return vectors;
}

export async function rerankDocuments(query: string, documents: string[], topN: number) {
  if (!documents.length || env.model.mode === "mock") return documents.map((_, index) => ({ index, score: 1 - index / Math.max(documents.length, 1) }));
  const { model, apiKey } = configuredModel(env.retrieval.rerankerModelId, "RERANKER");
  const response = await fetch(endpoint(model.baseUrl, "/reranks"), {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: model.modelName, query, documents, top_n: Math.min(topN, documents.length) }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = (await response.json().catch(() => ({}))) as RerankPayload;
  if (!response.ok || !Array.isArray(payload.results)) throw new Error(payload.error?.message || payload.message || "Rerank 调用失败");
  return payload.results.map((item) => ({ index: item.index, score: Number(item.relevance_score) }));
}
