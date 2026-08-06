import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findModel, loadModels, type RuntimeModel } from "./models.js";

function readEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadEnv() {
  if (process.env.AITEAM_ENV_FILE) readEnvFile(path.resolve(process.env.AITEAM_ENV_FILE));
  readEnvFile(path.resolve(process.cwd(), "config/.env.local"));
  readEnvFile(path.resolve(process.cwd(), ".env.local"));
  readEnvFile(path.resolve(process.cwd(), ".env"));
  readEnvFile(path.resolve(process.cwd(), "config/.env.dev"));
  readEnvFile(path.resolve(process.cwd(), "../.env"));
  readEnvFile(path.resolve(process.cwd(), "../../.env"));
  readEnvFile(path.join(os.homedir(), ".hermes/.env"));
}

loadEnv();

process.env.MODEL_BASE_URL ||= process.env.ZW_AI_HIGRESS_BASE_URL;
process.env.OPENAI_API_KEY ||= process.env.ZW_AI_HIGRESS_API_KEY || process.env.HIGRESS_API_KEY;
process.env.EMBEDDING_BASE_URL ||= process.env.ZW_AI_EMBEDDING_BASE_URL;
process.env.EMBEDDING_API_KEY ||= process.env.ZW_AI_EMBEDDING_API_KEY;
process.env.DASHSCOPE_API_BASE_URL ||= process.env.ZW_AI_DASHSCOPE_API_BASE_URL;

function dashscopeRerankBase(value: string) {
  try {
    return `${new URL(value).origin}/compatible-api/v1`;
  } catch {
    return "https://dashscope.aliyuncs.com/compatible-api/v1";
  }
}

process.env.DASHSCOPE_RERANK_BASE_URL ||= dashscopeRerankBase(
  process.env.DASHSCOPE_API_BASE_URL || process.env.ZW_AI_DASHSCOPE_API_BASE_URL || "https://dashscope.aliyuncs.com/api/v1"
);
process.env.ZW_AI_DASHSCOPE_RERANK_BASE_URL ||= process.env.DASHSCOPE_RERANK_BASE_URL;

function pick(keys: string[], fallback = "") {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function pickNumber(keys: string[], fallback: number) {
  const value = pick(keys);
  return value ? Number(value) : fallback;
}

function pickBoolean(keys: string[], fallback: boolean) {
  const value = pick(keys);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function projectPath(value: string) {
  return path.resolve(process.cwd(), value);
}

const modelFallback: RuntimeModel = {
  id: "gpt-5.5",
  key: "gpt-5.5",
  name: "gpt-5.5",
  modelName: "gpt-5.5",
  kind: "LLM",
  provider: "model_openai_provider",
  baseUrl: pick(["MODEL_BASE_URL", "ZW_AI_HIGRESS_BASE_URL"], "https://api.openai.com/v1"),
  apiKeyEnv: pick(
    ["MODEL_API_KEY_ENV"],
    process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : process.env.ZW_AI_HIGRESS_API_KEY ? "ZW_AI_HIGRESS_API_KEY" : "HIGRESS_API_KEY"
  ),
  maxTokens: pickNumber(["MODEL_MAX_TOKENS"], 8192),
  supportsVision: true,
  capabilities: ["fast_chat", "analysis", "vision"]
};

const modelConfigPath = projectPath(pick(["MODEL_CONFIG_PATH", "ZW_AI_MODEL_CONFIG_PATH"], "config/model.yaml"));
const models = loadModels(modelConfigPath, modelFallback);
const defaultModelId = pick(["MODEL_DEFAULT_ID", "ZW_AI_DEFAULT_MODEL"], "gpt-5.5");
const defaultModel = findModel(models, defaultModelId) || modelFallback;

export const env = {
  runtime: pick(["AITEAM_ENV", "ZW_AI_ENV", "NODE_ENV"], "local"),
  host: pick(["HOST", "AITEAM_HOST"], "127.0.0.1"),
  port: pickNumber(["PORT", "AITEAM_PORT"], 8788),
  publicBaseUrl: pick(["PUBLIC_BASE_URL", "AITEAM_PUBLIC_BASE_URL"], `http://127.0.0.1:${pickNumber(["PORT", "AITEAM_PORT"], 8788)}`),
  frontendOrigin: pick(["FRONTEND_ORIGIN", "AITEAM_FRONTEND_ORIGIN"], "http://127.0.0.1:5178"),
  authSecret: pick(["AUTH_SECRET", "AITEAM_AUTH_SECRET"], "aiteam-dev-secret-change-me"),
  database: {
    name: pick(["DATABASE_NAME", "ZW_AI_DB_NAME"], "aiteam_app"),
    host: pick(["DATABASE_HOST", "ZW_AI_DB_HOST"], "127.0.0.1"),
    port: pickNumber(["DATABASE_PORT", "ZW_AI_DB_PORT"], 5432),
    user: pick(["DATABASE_USER", "ZW_AI_DB_USER"]) || undefined,
    password: pick(["DATABASE_PASSWORD", "ZW_AI_DB_PASSWORD"]) || undefined,
    url: pick(["DATABASE_URL", "ZW_AI_DATABASE_URL"]) || undefined
  },
  redis: {
    host: pick(["REDIS_HOST", "ZW_AI_REDIS_HOST"], "127.0.0.1"),
    port: pickNumber(["REDIS_PORT", "ZW_AI_REDIS_PORT"], 6379),
    password: pick(["REDIS_PASSWORD", "ZW_AI_REDIS_PASSWORD"]),
    db: pickNumber(["REDIS_DB", "ZW_AI_REDIS_DB"], 0)
  },
  model: {
    id: defaultModelId,
    selected: defaultModel,
    models,
    configPath: modelConfigPath,
    mode: pick(["AITEAM_MODEL_MODE"], "real")
  },
  gbrain: {
    baseUrl: pick(["GBRAIN_BASE_URL", "AITEAM_GBRAIN_BASE_URL"], "http://127.0.0.1:3131"),
    mcpUrl: pick(["GBRAIN_MCP_URL", "AITEAM_GBRAIN_MCP_URL"], "http://127.0.0.1:3131/mcp"),
    token: pick(["GBRAIN_TOKEN", "AITEAM_GBRAIN_TOKEN"]),
    cli: pick(["GBRAIN_CLI", "AITEAM_GBRAIN_CLI"], "../gbrain/src/cli.ts")
  },
  documentProcessor: {
    mode: pick(["DOCUMENT_PROCESSOR_MODE", "AITEAM_DOCUMENT_PROCESSOR_MODE"], "auto") as "auto" | "eopera" | "native",
    baseUrl: pick(["EOPERA_BASE_URL", "DOCUMENT_PROCESSOR_BASE_URL"]),
    endpoint: pick(["EOPERA_PROCESS_OSS_PATH"], "/api/v1/integration/documents/process-oss"),
    timeoutMs: pickNumber(["DOCUMENT_PROCESSOR_TIMEOUT_MS", "EOPERA_TIMEOUT_MS"], 200_000),
    sourceUrlTtlSeconds: pickNumber(["DOCUMENT_SOURCE_URL_TTL_SECONDS"], 600),
    mediaAnalysisEnabled: pickBoolean(["DOCUMENT_MEDIA_ANALYSIS_ENABLED"], true),
    mediaAnalysisConcurrency: pickNumber(["DOCUMENT_MEDIA_ANALYSIS_CONCURRENCY"], 3),
    mediaMaterializationConcurrency: pickNumber(["DOCUMENT_MEDIA_MATERIALIZATION_CONCURRENCY"], 4)
  },
  storageRoot: projectPath(pick(["STORAGE_ROOT", "AITEAM_STORAGE_ROOT"], "../storage")),
  storageDriver: pick(["STORAGE_DRIVER", "AITEAM_STORAGE_DRIVER"], "local") as "local" | "oss",
  logs: {
    level: pick(["LOG_LEVEL", "ZW_AI_LOG_LEVEL"], "info"),
    dir: pick(["LOG_DIR", "ZW_AI_LOG_DIR"], "./logs")
  },
  embedding: {
    modelName: pick(["EMBEDDING_MODEL_NAME", "ZW_AI_EMBEDDING_MODEL_NAME"]),
    modelPath: pick(["EMBEDDING_MODEL_PATH", "ZW_AI_EMBEDDING_MODEL_PATH"]),
    baseUrl: pick(["EMBEDDING_BASE_URL", "ZW_AI_EMBEDDING_BASE_URL"]),
    apiKeyEnv: process.env.ZW_AI_EMBEDDING_API_KEY ? "ZW_AI_EMBEDDING_API_KEY" : pick(["EMBEDDING_API_KEY_ENV"], "EMBEDDING_API_KEY"),
    multimodalModel: pick(["MULTIMODAL_EMBEDDING_MODEL"], "multimodal-embedding-v1"),
    multimodalUrl: pick(
      ["MULTIMODAL_EMBEDDING_URL"],
      `${pick(["DASHSCOPE_API_BASE_URL", "ZW_AI_DASHSCOPE_API_BASE_URL"], "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/, "")}/services/embeddings/multimodal-embedding/multimodal-embedding`
    )
  },
  retrieval: {
    embeddingModelId: pick(["RETRIEVAL_EMBEDDING_MODEL_ID"], "embedding_qwen_text_embedding_v3"),
    embeddingDimensions: pickNumber(["RETRIEVAL_EMBEDDING_DIMENSIONS"], 1024),
    rerankerModelId: pick(["RETRIEVAL_RERANKER_MODEL_ID"], "reranker_aliyun_qwen3_rerank"),
    candidateLimit: pickNumber(["RETRIEVAL_CANDIDATE_LIMIT"], 30),
    rerankInputLimit: pickNumber(["RETRIEVAL_RERANK_INPUT_LIMIT"], 20),
    resultLimit: pickNumber(["RETRIEVAL_RESULT_LIMIT"], 10),
    cacheTtlSeconds: pickNumber(["RETRIEVAL_CACHE_TTL_SECONDS"], 300)
  },
  channels: {
    wechatBaseUrl: pick(["WECHAT_ILINK_BASE_URL"], "https://ilinkai.weixin.qq.com"),
    pollTimeoutMs: pickNumber(["WECHAT_ILINK_POLL_TIMEOUT_MS"], 40_000),
    qrTtlSeconds: pickNumber(["WECHAT_ILINK_QR_TTL_SECONDS"], 120)
  },
  oss: {
    endpoint: pick(["OSS_ENDPOINT", "ZW_AI_OSS_ENDPOINT"]),
    bucket: pick(["OSS_BUCKET", "ZW_AI_OSS_BUCKET"]),
    accessKeyIdEnv: process.env.ZW_AI_OSS_ACCESS_KEY_ID ? "ZW_AI_OSS_ACCESS_KEY_ID" : "OSS_ACCESS_KEY_ID",
    accessKeySecretEnv: process.env.ZW_AI_OSS_ACCESS_KEY_SECRET ? "ZW_AI_OSS_ACCESS_KEY_SECRET" : "OSS_ACCESS_KEY_SECRET",
    prefix: pick(["OSS_PREFIX", "ZW_AI_OSS_PREFIX"], "aiteam"),
    signedUrlExpireSeconds: pickNumber(["OSS_SIGNED_URL_EXPIRE_SECONDS", "ZW_AI_OSS_SIGNED_URL_EXPIRE_SECONDS"], 3600)
  }
};

if (env.runtime === "production") {
  if (!env.authSecret || env.authSecret === "aiteam-dev-secret-change-me" || env.authSecret.length < 32) {
    throw new Error("生产环境必须配置至少 32 位的 AUTH_SECRET，且不能使用默认密钥");
  }
  if (!env.frontendOrigin.startsWith("https://") || !env.publicBaseUrl.startsWith("https://")) {
    throw new Error("生产环境的 FRONTEND_ORIGIN 与 PUBLIC_BASE_URL 必须使用 HTTPS");
  }
}
