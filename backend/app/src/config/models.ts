import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type ModelKind = "LLM" | "IMAGE" | "EMBEDDING" | "RERANKER" | "TTI" | "UNKNOWN";

export interface RuntimeModel {
  id: string;
  key: string;
  name: string;
  modelName: string;
  kind: ModelKind;
  iconUrl?: string;
  provider?: string;
  baseUrl: string;
  apiKeyEnv: string;
  maxTokens: number;
  supportsVision: boolean;
  capabilities: string[];
}

interface RawModel {
  key?: string;
  name?: string;
  icon_url?: string;
  provider?: string;
  model_type?: string;
  model_name?: string;
  model_id?: string;
  api_key_env?: string;
  base_url?: string;
  supports_vision?: boolean;
  capabilities?: string[];
  credential?: {
    api_base?: string;
    api_key?: string;
    dashscope_api_key?: string;
  };
  model_params_form?: Array<{
    field?: string;
    default_value?: number | string;
  }>;
  max_tokens?: number | string;
}

function expandEnv(value = "") {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key: string) => process.env[key] || "");
}

function envNameFromTemplate(value = "") {
  const match = value.match(/^\$\{([A-Z0-9_]+)\}$/i);
  return match?.[1] || "";
}

function maxTokens(raw: RawModel, fallback: number) {
  const formValue = raw.model_params_form?.find((item) => item.field === "max_completion_tokens")?.default_value;
  return Number(raw.max_tokens || formValue || fallback);
}

function inferCapabilities(raw: RawModel, supportsVision: boolean) {
  if (raw.capabilities?.length) return raw.capabilities;
  const capabilities = ["fast_chat", "analysis"];
  if (supportsVision) capabilities.push("vision");
  return capabilities;
}

function normalizeModel(raw: RawModel, fallback: RuntimeModel): RuntimeModel | null {
  const name = raw.name || raw.model_name || raw.model_id || raw.key;
  const modelName = raw.model_name || raw.model_id || raw.name;
  if (!name || !modelName) return null;

  const credentialKey = raw.credential?.api_key || raw.credential?.dashscope_api_key || "";
  const apiKeyEnv = raw.api_key_env || envNameFromTemplate(credentialKey) || fallback.apiKeyEnv;
  const kind = (raw.model_type || "UNKNOWN").toUpperCase() as ModelKind;
  const supportsVision = Boolean(raw.supports_vision || kind === "IMAGE" || name.toLowerCase().includes("vision"));

  return {
    id: raw.key || name,
    key: raw.key || name,
    name,
    modelName,
    kind,
    iconUrl: raw.icon_url,
    provider: raw.provider,
    baseUrl: expandEnv(raw.base_url || raw.credential?.api_base || fallback.baseUrl),
    apiKeyEnv,
    maxTokens: maxTokens(raw, fallback.maxTokens),
    supportsVision,
    capabilities: inferCapabilities(raw, supportsVision)
  };
}

export function findModel(models: RuntimeModel[], idOrName: string) {
  return models.find((model) => [model.id, model.key, model.name, model.modelName].includes(idOrName));
}

export function loadModels(configPath: string, fallback: RuntimeModel) {
  const absolutePath = path.resolve(configPath);
  if (!fs.existsSync(absolutePath)) return [fallback];

  const parsed = YAML.parse(fs.readFileSync(absolutePath, "utf8")) as { models?: RawModel[] } | null;
  const models = (parsed?.models || [])
    .map((raw) => normalizeModel(raw, fallback))
    .filter((model): model is RuntimeModel => Boolean(model));

  return models.length ? models : [fallback];
}
