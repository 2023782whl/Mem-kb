import { env } from "../../config/env.js";
import { findModel, type RuntimeModel } from "../../config/models.js";
import { one, query } from "../../db/pool.js";
import { decryptSecret, sha256 } from "../../utils/crypto.js";
import type { ModelConfigRow, ResolvedModel } from "./types.js";

function staticResolved(model: RuntimeModel): ResolvedModel {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey && env.model.mode !== "mock") throw new Error(`缺少模型密钥环境变量：${model.apiKeyEnv}`);
  return {
    ...model,
    apiProtocol: "openai_chat_completions",
    apiKey: apiKey || "mock-key",
    temperature: 0.2,
    extraBody: {},
    source: "static"
  };
}

export function modelFingerprint(input: Pick<ModelConfigRow, "api_protocol" | "base_url" | "model_name" | "kind" | "temperature" | "max_tokens" | "supports_vision" | "extra_body">, apiKey: string) {
  return sha256(JSON.stringify({
    protocol: input.api_protocol,
    baseUrl: input.base_url.replace(/\/$/, ""),
    model: input.model_name,
    kind: input.kind,
    temperature: input.temperature,
    maxTokens: input.max_tokens,
    supportsVision: input.supports_vision,
    extraBody: input.extra_body,
    key: sha256(apiKey)
  }));
}

export function isVerifiedConfig(row: ModelConfigRow, apiKey: string) {
  return row.verification_status === "verified" && row.verified_fingerprint === modelFingerprint(row, apiKey);
}

export function resolvedConfig(row: ModelConfigRow): ResolvedModel {
  const apiKey = decryptSecret(row.api_key_encrypted, env.model.secret);
  return {
    id: row.id,
    key: row.id,
    name: row.name,
    modelName: row.model_name,
    kind: row.kind,
    provider: row.api_protocol,
    baseUrl: row.base_url,
    apiKeyEnv: "",
    maxTokens: row.max_tokens,
    supportsVision: row.supports_vision,
    capabilities: row.capabilities,
    apiProtocol: row.api_protocol,
    apiKey,
    temperature: row.temperature,
    extraBody: row.extra_body,
    source: "tenant"
  };
}

export async function resolveRuntimeModel(tenantId: string | undefined, idOrName?: string, kind: RuntimeModel["kind"] = "LLM") {
  if (tenantId) {
    const values: unknown[] = [tenantId, kind];
    let identity = "and is_default = true and enabled = true";
    if (idOrName) {
      values.push(idOrName);
      identity = `and (id = $3 or name = $3 or model_name = $3)`;
    }
    const row = await one<ModelConfigRow>(
      `select * from model_configs
       where tenant_id = $1 and kind = $2 and deleted_at is null ${identity}
       order by is_default desc, updated_at desc limit 1`,
      values
    );
    if (row) {
      const resolved = resolvedConfig(row);
      if (!row.enabled) throw new Error(`模型尚未启用：${row.name}`);
      if (isVerifiedConfig(row, resolved.apiKey)) return resolved;
      throw new Error(`模型配置已变更，请重新验证：${row.name}`);
    }
  }
  const requested = findModel(env.model.models, idOrName || env.model.id);
  const fallback = requested && (!kind || requested.kind === kind)
    ? requested
    : env.model.models.find((model) => model.kind === kind && Boolean(process.env[model.apiKeyEnv])) || env.model.selected;
  return staticResolved(fallback);
}

export async function modelCatalog(tenantId?: string) {
  const dynamic = tenantId
    ? await query<ModelConfigRow>(`select * from model_configs where tenant_id = $1 and deleted_at is null order by created_at desc`, [tenantId])
    : [];
  const configured = dynamic.map((row) => ({
    id: row.id,
    name: row.name,
    modelName: row.model_name,
    kind: row.kind,
    capabilities: row.capabilities,
    maxTokens: row.max_tokens,
    supportsVision: row.supports_vision,
    configured: row.enabled && row.verification_status === "verified",
    source: "tenant" as const,
    apiProtocol: row.api_protocol,
    enabled: row.enabled,
    isDefault: row.is_default,
    verificationStatus: row.verification_status,
    verificationError: row.verification_error,
    configurable: true
  }));
  const dynamicDefaultKinds = new Set(dynamic.filter((row) => row.is_default).map((row) => row.kind));
  const staticModels = env.model.models.map((model) => ({
    id: model.id,
    name: model.name,
    modelName: model.modelName,
    kind: model.kind,
    iconUrl: model.iconUrl,
    capabilities: model.capabilities,
    maxTokens: model.maxTokens,
    supportsVision: model.supportsVision,
    configured: Boolean(process.env[model.apiKeyEnv]) || env.model.mode === "mock",
    source: "static" as const,
    apiProtocol: "openai_chat_completions" as const,
    enabled: true,
    isDefault: model.id === env.model.id && !dynamicDefaultKinds.has(model.kind as "LLM" | "IMAGE"),
    verificationStatus: "verified" as const,
    verificationError: null,
    configurable: false
  }));
  return [...configured, ...staticModels];
}
