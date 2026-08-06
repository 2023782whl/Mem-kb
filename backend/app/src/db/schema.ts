export interface Tenant {
  id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  is_admin: boolean;
  status: "active" | "disabled";
  avatar_type: "initials" | "preset" | "upload";
  avatar_value: string | null;
  created_at: string;
}

export type UserRole = "admin" | "editor" | "viewer";

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
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  member_role?: WorkspaceRole;
  asset_count?: number;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

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

export interface AssetMedia {
  id: string;
  tenant_id: string;
  workspace_id: string;
  asset_id: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  sequence: number;
  alt_text: string;
  ocr_text: string;
  description: string;
  anchor: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  workspace_id: string;
  workspace_ids: string[];
  user_id: string;
  title: string;
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

export interface QaTrace {
  id: string;
  tenant_id: string;
  workspace_id: string;
  workspace_ids: string[];
  user_id: string;
  conversation_id: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
  source: "web" | "wechat";
  status: "running" | "completed" | "failed" | "cancelled";
  rating: "up" | "down" | null;
  issue_type: string;
  question: string;
  answer_preview: string;
  model_id: string;
  source_flags: Record<string, unknown>;
  citation_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface QaTraceEvent {
  id: string;
  tenant_id: string;
  trace_id: string;
  phase: string;
  status: "running" | "completed" | "failed" | "skipped";
  detail: string;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RagEvaluationRun {
  id: string;
  tenant_id: string;
  workspace_id: string;
  created_by: string;
  status: "running" | "completed" | "failed";
  query_count: number;
  recall: number;
  accuracy: number;
  citation_correctness: number;
  error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface ConsolidationConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  schedule_time: string;
  timezone: string;
  workspace_ids: string[];
  updated_by: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsolidationRun {
  id: string;
  tenant_id: string;
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
  created_at: string;
}

export interface ChannelBinding {
  id: string;
  tenant_id: string;
  created_by: string;
  channel: "wechat";
  workspace_ids: string[];
  status: "pending" | "active" | "expired" | "disabled";
  connected: boolean;
  credentials_enc: string | null;
  config: Record<string, unknown>;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  id: string;
  message_id: string;
  workspace_id: string | null;
  asset_id: string | null;
  gbrain_slug: string | null;
  title: string;
  snippet: string;
  score: number;
  kind: "document" | "image" | "web";
  url: string | null;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  tenant_id: string;
  workspace_id: string;
  asset_id: string;
  chunk_index: number;
  heading: string;
  content: string;
  content_hash: string;
  model_id: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessUnit {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface Category {
  id: string;
  tenant_id: string;
  workspace_id: string;
  parent_id: string | null;
  level: 1 | 2 | 3;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  workspace_id: string;
  category_id: string;
  name: string;
  sort_order: number;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface NoteFolder {
  id: string;
  tenant_id: string;
  workspace_id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  tenant_id: string;
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
  tenant_id: string;
  workspace_id: string;
  note_id: string;
  published_asset_id: string | null;
  created_by: string;
  version: number;
  title: string;
  content_markdown: string;
  content_json: Record<string, unknown>;
  content_hash: string;
  created_at: string;
}

export interface NoteFact {
  id: string;
  tenant_id: string;
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
