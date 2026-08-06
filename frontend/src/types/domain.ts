export interface User {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  is_admin: boolean;
  status: "active" | "disabled";
  avatar_type?: "initials" | "preset" | "upload";
  avatar_value?: string | null;
  created_at: string;
  resource_count?: number;
}

export interface Workspace {
  id: string;
  tenant_id: string;
  owner_id: string;
  business_unit_id: string | null;
  name: string;
  description: string;
  scope: "personal" | "team";
  kind: "document" | "image" | "mixed";
  gbrain_source_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  member_role?: "owner" | "editor" | "viewer";
  asset_count?: number;
}

export interface WorkspaceMember {
  user_id: string;
  email: string;
  name: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
}

export interface Asset {
  id: string;
  tenant_id: string;
  workspace_id: string;
  owner_id: string;
  category_id: string | null;
  product_id: string | null;
  type: "document" | "image" | "video" | "webpage" | "ai_answer";
  format: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  sha256: string;
  status: "queued" | "indexing" | "ready" | "failed" | "deleted";
  summary: string | null;
  extracted_text: string | null;
  index_text: string | null;
  markdown_storage_key: string | null;
  thumbnail_storage_key: string | null;
  processing_provider: string | null;
  processing_version: string | null;
  processed_at: string | null;
  gbrain_slug: string | null;
  source_url: string | null;
  ocr_text: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  workspace_id: string;
  workspace_ids: string[];
  model_id: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  model_id: string | null;
  created_at: string;
}

export interface Citation {
  id?: string;
  message_id?: string;
  workspaceId?: string | null;
  title: string;
  snippet: string;
  slug?: string | null;
  assetId?: string | null;
  score?: number;
  kind?: "document" | "image" | "web";
  url?: string | null;
}

export interface ConversationMessage extends Message {
  citations: Citation[];
  status?: "streaming" | "complete" | "stopped" | "error";
  error?: string;
}

export interface ChannelBinding {
  id: string;
  tenant_id: string;
  created_by: string;
  creator_name?: string;
  channel: "wechat";
  workspace_ids: string[];
  workspace_names?: string[];
  status: "pending" | "active" | "expired" | "disabled";
  connected: boolean;
  config: {
    ilinkBotId?: string;
    ilinkUserId?: string;
    boundAt?: string;
    qrExpiresAt?: string;
    lastError?: string | null;
  };
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelIdentity {
  id: string;
  binding_id: string;
  external_user_id: string;
  user_id: string | null;
  user_name?: string | null;
  display_name: string;
  is_group: boolean;
  updated_at: string;
}

export interface ChannelMessage {
  id: string;
  binding_id: string;
  external_conversation_id: string;
  external_user_id: string;
  direction: "inbound" | "outbound";
  is_group: boolean;
  content: string;
  status: "received" | "processing" | "completed" | "failed";
  error: string | null;
  created_at: string;
}

export interface ChannelDelivery {
  id: string;
  binding_id: string;
  external_conversation_id: string;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface QaTrace {
  id: string;
  workspace_id: string;
  workspace_ids: string[];
  workspace_name?: string;
  user_id: string;
  user_name?: string;
  conversation_id: string | null;
  source: "web" | "wechat";
  status: "running" | "completed" | "failed" | "cancelled";
  rating: "up" | "down" | null;
  issue_type: string;
  question: string;
  answer_preview: string;
  model_id: string;
  citation_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface QaTraceEvent {
  id: string;
  trace_id: string;
  phase: string;
  status: "running" | "completed" | "failed" | "skipped";
  detail: string;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface QaTraceDetail {
  trace: QaTrace;
  events: QaTraceEvent[];
  messages: Message[];
  citations: Citation[];
}

export interface RagEvaluationRun {
  id: string;
  workspace_id: string;
  workspace_name?: string;
  status: "running" | "completed" | "failed";
  query_count: number;
  recall: number;
  accuracy: number;
  citation_correctness: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface RagEvaluationQuery {
  id: string;
  question: string;
  status: "passed" | "failed" | "skipped";
  expected_document_ids: string[];
  hit_document_ids: string[];
  missed_document_ids: string[];
  hit_documents: Array<{ id: string; title: string }>;
  missed_documents: Array<{ id: string; title: string }>;
  recall: number;
  accuracy: number;
  citation_correct: boolean;
  failure_reason: string | null;
  details: Record<string, unknown>;
  duration_ms: number;
}

export interface ConsolidationConfig {
  id: string;
  enabled: boolean;
  schedule_time: string;
  timezone: string;
  workspace_ids: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  updated_at: string;
}

export interface ConsolidationRun {
  id: string;
  trigger: "manual" | "cron";
  status: "running" | "completed" | "failed";
  workspace_ids: string[];
  conversations_scanned: number;
  relations_added: number;
  citations_repaired: number;
  structures_organized: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ConsolidationLog {
  id: string;
  run_id: string;
  phase: string;
  level: "info" | "warning" | "error";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  format?: string;
  summary: string;
  assetId?: string | null;
  slug?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  evidence?: string;
  sourceType?: "workspace" | "explicit" | "entity_overlap" | "semantic" | string;
  confidence?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  modelName: string;
  kind: string;
  iconUrl?: string;
  configured: boolean;
  supportsVision: boolean;
  maxTokens?: number;
  capabilities?: string[];
  source?: "static" | "tenant";
  apiProtocol?: ModelProtocol;
  enabled?: boolean;
  isDefault?: boolean;
  verificationStatus?: ModelVerificationStatus;
  verificationError?: string | null;
  configurable?: boolean;
}

export type ModelProtocol = "openai_chat_completions" | "anthropic_messages" | "gemini_generate_content";
export type ModelVerificationStatus = "unverified" | "verifying" | "verified" | "failed";

export interface ModelConfig {
  id: string;
  tenant_id: string;
  name: string;
  kind: "LLM" | "IMAGE";
  api_protocol: ModelProtocol;
  base_url: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  supports_vision: boolean;
  capabilities: string[];
  extra_body: Record<string, unknown>;
  enabled: boolean;
  is_default: boolean;
  verification_status: ModelVerificationStatus;
  verification_error: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelConfigInput {
  name: string;
  kind: "LLM" | "IMAGE";
  apiProtocol: ModelProtocol;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  supportsVision: boolean;
  capabilities: string[];
  extraBody: Record<string, unknown>;
}

export interface InsightItem {
  question?: string;
  asset_id?: string;
  title?: string;
  count: number;
}

export interface Category {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  level: 1 | 2 | 3;
  name: string;
  sort_order: number;
}

export interface Product {
  id: string;
  workspace_id: string;
  category_id: string;
  name: string;
  sort_order: number;
}

export interface BusinessUnit {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
}

export interface NoteFolder {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  workspace_id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  content_markdown: string;
  content_json: Record<string, unknown>;
  source_asset_id: string | null;
  published_asset_id: string | null;
  tags: string[];
  is_favorite: boolean;
  status: "active" | "deleted";
  sync_status: "pending" | "synced" | "failed";
  sync_error: string | null;
  gbrain_slug: string;
  version: number;
  published_version: number;
  auto_publish: boolean;
  last_published_hash: string | null;
  last_published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteRevision {
  id: string;
  note_id: string;
  published_asset_id: string | null;
  version: number;
  title: string;
  content_markdown: string;
  content_json: Record<string, unknown>;
  content_hash: string;
  created_at: string;
}

export interface NoteFact {
  id: string;
  workspace_id: string;
  note_id: string;
  gbrain_fact_id: number | null;
  fact: string;
  corrected_fact: string | null;
  kind: string;
  entity_slug: string | null;
  confidence: number;
  status: "pending" | "verified" | "forgotten";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NoteLifecycle {
  tags: string[];
  versions: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  backlinks: Array<Record<string, unknown>>;
  revisions: NoteRevision[];
}

export interface NoteAssistantSource {
  assetId: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
}

export interface NoteOverview {
  summary: string;
  keyPoints: string[];
  suggestedQuestions: string[];
}

export type GBrainObject = Record<string, unknown>;

export interface CapabilityResult<T> {
  available: boolean;
  data: T | null;
  error?: string;
}

export interface GBrainSeed {
  id: string;
  title: string;
  slug: string;
  kind: "asset" | "note" | "fact";
}

export interface GBrainGraphDetail {
  slug: string;
  depth: number;
  paths: CapabilityResult<GBrainObject[]>;
  backlinks: CapabilityResult<GBrainObject[] | GBrainObject>;
  timeline: CapabilityResult<GBrainObject[] | GBrainObject>;
  tags: CapabilityResult<string[] | { tags?: string[] }>;
  trajectory: CapabilityResult<GBrainObject>;
}

export interface GBrainIntelligence {
  anomalies: CapabilityResult<GBrainObject[]>;
  experts: CapabilityResult<GBrainObject[]>;
  contradictions: CapabilityResult<GBrainObject>;
  ontology: CapabilityResult<GBrainObject[]>;
  dimensions: CapabilityResult<GBrainObject[]>;
  conflicts: CapabilityResult<GBrainObject[]>;
}

export interface GBrainSourceStatus {
  source: GBrainObject & { id: string; name: string; page_count: number; federated: boolean };
  status: CapabilityResult<GBrainObject>;
}

export interface GBrainOperations {
  identity: CapabilityResult<GBrainObject>;
  stats: CapabilityResult<GBrainObject>;
  health: CapabilityResult<GBrainObject>;
  snapshot: CapabilityResult<GBrainObject>;
  sources: CapabilityResult<{ sources?: GBrainObject[] }>;
  sourceStatuses: GBrainSourceStatus[];
  jobs: CapabilityResult<Array<GBrainObject & { id: number; name: string; status: string; queue: string }>>;
  auditLogs: Array<GBrainObject & { id: string; action: string; created_at: string; user_name?: string | null }>;
}

export interface GBrainGovernance {
  advisor: CapabilityResult<GBrainObject>;
  activeSchema: CapabilityResult<GBrainObject>;
  schemaPacks: CapabilityResult<GBrainObject>;
  schemaStats: CapabilityResult<GBrainObject>;
  skills: CapabilityResult<GBrainObject>;
  skillpacks: CapabilityResult<GBrainObject>;
  linkSources: CapabilityResult<GBrainObject[]>;
  dimensions: CapabilityResult<GBrainObject[]>;
  conflicts: CapabilityResult<GBrainObject[]>;
}
