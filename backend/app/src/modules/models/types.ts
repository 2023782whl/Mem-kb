import type { ModelKind, RuntimeModel } from "../../config/models.js";

export type ModelProtocol = "openai_chat_completions" | "anthropic_messages" | "gemini_generate_content";
export type ModelVerificationStatus = "unverified" | "verifying" | "verified" | "failed";

export interface ModelConfigRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: "LLM" | "IMAGE";
  api_protocol: ModelProtocol;
  base_url: string;
  model_name: string;
  api_key_encrypted: string;
  temperature: number;
  max_tokens: number;
  supports_vision: boolean;
  capabilities: string[];
  extra_body: Record<string, unknown>;
  enabled: boolean;
  is_default: boolean;
  verification_status: ModelVerificationStatus;
  verification_error: string | null;
  verified_fingerprint: string | null;
  config_revision: number;
  security_revision: number;
  key_revision: number;
  verified_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedModel extends RuntimeModel {
  apiProtocol: ModelProtocol;
  apiKey: string;
  temperature: number;
  extraBody: Record<string, unknown>;
  source: "static" | "tenant";
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

export interface ModelRequestOptions {
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export function supportsKind(kind: ModelKind): kind is "LLM" | "IMAGE" {
  return kind === "LLM" || kind === "IMAGE";
}
