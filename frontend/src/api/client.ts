import type {
  Asset, BusinessUnit, Category, Citation, Conversation, ConversationMessage,
  GraphEdge, GraphNode, InsightItem, Message, ModelInfo, Note, NoteFact, NoteFolder, NoteOverview,
  NoteLifecycle, Product, User, Workspace, WorkspaceMember, GBrainGraphDetail, GBrainGovernance,
  GBrainIntelligence, GBrainObject, GBrainOperations, GBrainSeed, NoteAssistantSource, NoteRevision,
  ChannelBinding, ChannelDelivery, ChannelIdentity, ChannelMessage, QaTrace, QaTraceDetail,
  ConsolidationConfig, ConsolidationLog, ConsolidationRun, RagEvaluationQuery, RagEvaluationRun,
  ModelConfig, ModelConfigInput
} from "../types/domain";
import { formatAssistantError } from "../shared/AssistantExperience";

const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://127.0.0.1:8788" : "");

function headers(body?: BodyInit | null) {
  return {
    ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {})
  };
}

function notifyUnauthorized(response: Response) {
  if (response.status === 401) window.dispatchEvent(new Event("aiteam:unauthorized"));
}

async function request<T>(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: { ...headers(init.body), ...init.headers }
    });
  } catch {
    throw new Error("无法连接 Mem-kb 服务，请确认后端已启动");
  }
  const payload = await response.json().catch(() => ({}));
  notifyUnauthorized(response);
  if (!response.ok) throw new Error(payload.message || payload.error || "请求失败");
  return payload as T;
}

export interface AskBody {
  workspaceId: string;
  workspaceIds?: string[];
  assetIds?: string[];
  question: string;
  modelId?: string;
  conversationId?: string;
  options?: { documentQa?: boolean; webSearch?: boolean; imageSearch?: boolean };
}

export interface StreamHandlers {
  meta?: (data: { conversationId: string; userMessageId: string }) => void;
  citation?: (data: Citation) => void;
  delta?: (data: { text: string }) => void;
  done?: (data: { assistantMessage: Message; answer: string }) => void;
}

async function streamAsk(body: AskBody, handlers: StreamHandlers, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/qa/stream`, {
      method: "POST",
      credentials: "include",
      headers: headers(JSON.stringify(body)),
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(formatAssistantError(error, "无法连接 AI 问答服务"));
  }
  notifyUnauthorized(response);
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "流式问答失败");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      const payload: unknown = JSON.parse(data);
      if (event === "error") throw new Error(formatAssistantError((payload as { message?: string }).message, "流式问答失败"));
      if (event === "meta") handlers.meta?.(payload as Parameters<NonNullable<StreamHandlers["meta"]>>[0]);
      if (event === "citation") handlers.citation?.(payload as Citation);
      if (event === "delta") handlers.delta?.(payload as { text: string });
      if (event === "done") handlers.done?.(payload as Parameters<NonNullable<StreamHandlers["done"]>>[0]);
    }
  }
}

async function streamNoteAssist(
  noteId: string,
  body: {
    action: "continue" | "rewrite" | "summarize" | "outline" | "custom";
    instruction?: string;
    selection?: string;
    cursorContext?: string;
    assetIds?: string[];
    modelId?: string;
    locale?: "zh-CN" | "en-US";
    options?: { knowledgeSearch?: boolean; webSearch?: boolean };
  },
  handlers: { source?: (source: NoteAssistantSource) => void; delta?: (text: string) => void; done?: (answer: string) => void },
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/notes/${noteId}/assist/stream`, {
      method: "POST",
      credentials: "include",
      headers: headers(JSON.stringify(body)),
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(formatAssistantError(error, "无法连接 AI 写作服务"));
  }
  notifyUnauthorized(response);
  if (!response.ok || !response.body) throw new Error("AI 写作请求失败");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data) as { text?: string; answer?: string; message?: string };
      if (event === "error") throw new Error(formatAssistantError(payload.message, "AI 写作失败"));
      if (event === "source") handlers.source?.(payload as unknown as NoteAssistantSource);
      if (event === "delta" && payload.text) handlers.delta?.(payload.text);
      if (event === "done") handlers.done?.(payload.answer || "");
    }
  }
}

async function streamOptimizeNote(
  noteId: string,
  body: { title?: string; content?: string; modelId?: string; locale: "zh-CN" | "en-US" },
  handlers: {
    start?: (event: { total: number }) => void;
    chunkStart?: (event: { index: number; total: number }) => void;
    chunkReset?: (event: { index: number; total: number; markdown: string }) => void;
    delta?: (text: string) => void;
    chunkDone?: (event: { index: number; total: number }) => void;
    done?: (event: { markdown: string; fallback?: boolean }) => void;
  },
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/notes/${noteId}/optimize/stream`, {
      method: "POST",
      credentials: "include",
      headers: headers(JSON.stringify(body)),
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(formatAssistantError(error, "无法连接优化服务"));
  }
  notifyUnauthorized(response);
  if (!response.ok || !response.body) throw new Error("优化文档请求失败");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data) as { text?: string; markdown?: string; message?: string; index?: number; total?: number; fallback?: boolean };
      if (event === "error") throw new Error(formatAssistantError(payload.message, "优化文档失败"));
      if (event === "start") handlers.start?.({ total: payload.total || 1 });
      if (event === "chunk-start") handlers.chunkStart?.({ index: payload.index || 0, total: payload.total || 1 });
      if (event === "chunk-reset") handlers.chunkReset?.({ index: payload.index || 0, total: payload.total || 1, markdown: payload.markdown || "" });
      if (event === "delta" && payload.text) handlers.delta?.(payload.text);
      if (event === "chunk-done") handlers.chunkDone?.({ index: payload.index || 0, total: payload.total || 1 });
      if (event === "done") handlers.done?.({ markdown: payload.markdown || "", fallback: payload.fallback });
    }
  }
}

async function assetBlob(assetId: string, variant: "original" | "thumbnail" = "original", signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/api/assets/${assetId}/content?variant=${variant}`, { credentials: "include", headers: headers(), signal });
  if (!response.ok) throw new Error("图片加载失败");
  return response.blob();
}

async function assetMediaBlob(assetId: string, mediaId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/api/assets/${encodeURIComponent(assetId)}/media/${encodeURIComponent(mediaId)}`, {
    credentials: "include",
    headers: headers(),
    signal
  });
  if (!response.ok) throw new Error("文档图片加载失败");
  return response.blob();
}

export const api = {
  login: (email: string, password: string, remember = false) => request<{ user: User; expiresAt: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/api/me"),
  health: () => request<{ ok: boolean; gbrain: Record<string, unknown>; models: ModelInfo[] }>("/api/health"),
  models: () => request<{ models: ModelInfo[] }>("/api/models"),
  modelConfigs: () => request<{ configs: ModelConfig[] }>("/api/model-configs"),
  createModelConfig: (body: ModelConfigInput & { apiKey: string }) => request<{ config: ModelConfig }>("/api/model-configs", { method: "POST", body: JSON.stringify(body) }),
  updateModelConfig: (id: string, body: Partial<ModelConfigInput>) => request<{ config: ModelConfig }>(`/api/model-configs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testModelConfig: (id: string) => request<{ config: ModelConfig; checks: { text: boolean; stream: boolean; json: boolean } }>(`/api/model-configs/${id}/test`, { method: "POST" }),
  enableModelConfig: (id: string, enabled: boolean) => request<{ config: ModelConfig }>(`/api/model-configs/${id}/enable`, { method: "POST", body: JSON.stringify({ enabled }) }),
  defaultModelConfig: (id: string) => request<{ config: ModelConfig }>(`/api/model-configs/${id}/default`, { method: "POST" }),
  deleteModelConfig: (id: string) => request<{ ok: boolean }>(`/api/model-configs/${id}`, { method: "DELETE" }),
  users: () => request<{ users: User[] }>("/api/users"),
  createUser: (body: { name: string; email: string; password: string; role: User["role"]; status: User["status"] }) =>
    request<{ user: User }>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: Partial<Pick<User, "name" | "email" | "role" | "status">> & { password?: string }) =>
    request<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  userAvatarUrl: (id: string, revision = "") => `${API_BASE}/api/users/${encodeURIComponent(id)}/avatar${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
  uploadMyAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ user: User }>("/api/me/avatar", { method: "POST", body: form });
  },
  setMyAvatar: (body: { type: "initials" } | { type: "preset"; value: string }) =>
    request<{ user: User }>("/api/me/avatar", { method: "PATCH", body: JSON.stringify(body) }),
  resetMyAvatar: () => request<{ user: User }>("/api/me/avatar", { method: "DELETE" }),
  businessUnits: () => request<{ businessUnits: BusinessUnit[] }>("/api/business-units"),
  workspaces: (status: "active" | "archived" | "all" = "active") => request<{ workspaces: Workspace[] }>(`/api/workspaces?status=${status}`),
  channels: () => request<{ bindings: ChannelBinding[] }>("/api/channels"),
  createChannel: (workspaceIds: string[]) => request<{ binding: ChannelBinding }>("/api/channels", { method: "POST", body: JSON.stringify({ workspaceIds }) }),
  updateChannel: (id: string, workspaceIds: string[]) => request<{ binding: ChannelBinding }>(`/api/channels/${id}`, { method: "PATCH", body: JSON.stringify({ workspaceIds }) }),
  deleteChannel: (id: string) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: "DELETE" }),
  channelQrCode: (id: string) => request<{ qrcode: string; content: string; expiresAt: string }>(`/api/channels/${id}/wechat/qrcode`, { method: "POST" }),
  channelQrStatus: (id: string, qrcode: string, verifyCode = "") => {
    const params = new URLSearchParams({ qrcode });
    if (verifyCode) params.set("verifyCode", verifyCode);
    return request<{ status: string; binding?: ChannelBinding }>(`/api/channels/${id}/wechat/qrcode-status?${params}`);
  },
  disconnectChannel: (id: string) => request<{ binding: ChannelBinding }>(`/api/channels/${id}/disconnect`, { method: "POST" }),
  channelMessages: (id: string) => request<{ messages: ChannelMessage[] }>(`/api/channels/${id}/messages`),
  channelDeliveries: (id: string) => request<{ deliveries: ChannelDelivery[] }>(`/api/channels/${id}/deliveries`),
  channelIdentities: (id: string) => request<{ identities: ChannelIdentity[] }>(`/api/channels/${id}/identities`),
  bindChannelIdentity: (id: string, identityId: string, userId: string | null) => request<{ identity: ChannelIdentity }>(`/api/channels/${id}/identities/${identityId}`, { method: "PATCH", body: JSON.stringify({ userId }) }),
  traces: (filters: { status?: string; rating?: string; issueType?: string; userId?: string; source?: string; search?: string; offset?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
    return request<{ items: QaTrace[]; total: number; offset: number; limit: number }>(`/api/traces?${params}`);
  },
  trace: (id: string) => request<QaTraceDetail>(`/api/traces/${id}`),
  evaluations: (workspaceId?: string) => request<{ runs: RagEvaluationRun[] }>(`/api/evaluations${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`),
  evaluation: (id: string) => request<{ run: RagEvaluationRun; queries: RagEvaluationQuery[] }>(`/api/evaluations/${id}`),
  runEvaluation: (workspaceId: string) => request<{ run: RagEvaluationRun }>("/api/evaluations/run", { method: "POST", body: JSON.stringify({ workspaceId }) }),
  consolidation: () => request<{ config: ConsolidationConfig; runs: ConsolidationRun[]; logs: ConsolidationLog[] }>("/api/consolidation"),
  updateConsolidation: (body: { enabled: boolean; scheduleTime: string; workspaceIds: string[] }) => request<{ config: ConsolidationConfig }>("/api/consolidation", { method: "PUT", body: JSON.stringify(body) }),
  runConsolidation: () => request<{ run: ConsolidationRun | null }>("/api/consolidation/run", { method: "POST" }),
  conversations: (workspaceId?: string) => request<{ conversations: Conversation[] }>(`/api/qa/conversations${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`),
  conversation: (id: string) => request<{ conversation: Conversation; messages: ConversationMessage[] }>(`/api/qa/conversations/${id}`),
  deleteConversation: (id: string) => request<{ ok: boolean }>(`/api/qa/conversations/${id}`, { method: "DELETE" }),
  createWorkspace: (body: Pick<Workspace, "name" | "description" | "scope" | "kind"> & { businessUnitId?: string | null }) =>
    request<{ workspace: Workspace }>("/api/workspaces", { method: "POST", body: JSON.stringify(body) }),
  updateWorkspace: (id: string, body: { name: string; description?: string }) => request<{ workspace: Workspace }>(`/api/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveWorkspace: (id: string) => request<{ workspace: Workspace }>(`/api/workspaces/${id}/archive`, { method: "POST" }),
  restoreWorkspace: (id: string) => request<{ workspace: Workspace }>(`/api/workspaces/${id}/restore`, { method: "POST" }),
  deleteWorkspace: (id: string) => request<{ ok: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  workspaceMembers: (id: string) => request<{ members: WorkspaceMember[] }>(`/api/workspaces/${id}/members`),
  addWorkspaceMember: (id: string, email: string, role: WorkspaceMember["role"]) => request<{ member: WorkspaceMember }>(`/api/workspaces/${id}/members`, { method: "POST", body: JSON.stringify({ email, role }) }),
  updateWorkspaceMember: (id: string, userId: string, role: WorkspaceMember["role"]) => request<{ ok: boolean }>(`/api/workspaces/${id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeWorkspaceMember: (id: string, userId: string) => request<{ ok: boolean }>(`/api/workspaces/${id}/members/${userId}`, { method: "DELETE" }),
  assets: (workspaceId: string, kind = "all", search = "", deleted = false) => {
    const params = new URLSearchParams({ workspaceId, kind, search });
    if (deleted) params.set("deleted", "true");
    return request<{ assets: Asset[] }>(`/api/assets?${params}`);
  },
  preview: (assetId: string, signal?: AbortSignal) => request<{ asset: Asset; text: string }>(`/api/assets/${assetId}/preview`, { signal }),
  assetBlob,
  assetMediaBlob,
  deleteAsset: (assetId: string) => request<{ ok: boolean; alreadyDeleted?: boolean; cleanupWarnings: string[]; gbrainStatus: string | null }>(`/api/assets/${assetId}`, { method: "DELETE" }),
  restoreAsset: (assetId: string) => request<{ asset: Asset }>(`/api/assets/${assetId}/restore`, { method: "POST" }),
  purgeAsset: (assetId: string) => request<{ ok: boolean; cleanupWarnings: string[] }>(`/api/assets/${assetId}/permanent`, { method: "DELETE" }),
  updateAsset: (assetId: string, body: { title?: string; workspaceId?: string; categoryId?: string | null; productId?: string | null; tags?: string[] }) => request<{ asset: Asset }>(`/api/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(body) }),
  downloadAsset: async (assetId: string, filename: string) => {
    const response = await fetch(`${API_BASE}/api/assets/${assetId}/download`, { credentials: "include" });
    notifyUnauthorized(response);
    if (!response.ok) throw new Error("文件下载失败");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
  retryAsset: (assetId: string) => request<{ asset: Asset }>(`/api/assets/${assetId}/retry`, { method: "POST" }),
  reprocessAsset: (assetId: string) => request<{ asset: Asset }>(`/api/assets/${assetId}/reprocess`, { method: "POST" }),
  upload: (workspaceId: string, file: File, relation: { categoryId?: string; productId?: string } = {}, onProgress?: (percent: number) => void) => {
    const body = new FormData();
    body.append("workspaceId", workspaceId);
    if (relation.categoryId) body.append("categoryId", relation.categoryId);
    if (relation.productId) body.append("productId", relation.productId);
    body.append("file", file);
    return new Promise<{ asset: Asset; deduplicated: boolean }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/assets/upload`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new Error("上传网络中断"));
      xhr.onload = () => {
        const payload = JSON.parse(xhr.responseText || "{}") as { asset?: Asset; deduplicated?: boolean; message?: string; error?: string };
        if (xhr.status === 401) window.dispatchEvent(new Event("aiteam:unauthorized"));
        if (xhr.status < 200 || xhr.status >= 300 || !payload.asset) {
          reject(new Error(payload.message || payload.error || "上传失败"));
          return;
        }
        onProgress?.(100);
        resolve({ asset: payload.asset, deduplicated: Boolean(payload.deduplicated) });
      };
      xhr.send(body);
    });
  },
  graph: (workspaceId: string) => request<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/workspaces/${workspaceId}/graph`),
  streamAsk,
  feedback: (messageId: string, value: "up" | "down") => request(`/api/qa/messages/${messageId}/feedback`, { method: "POST", body: JSON.stringify({ value }) }),
  capture: (messageId: string, body: { workspaceId: string; title: string; content: string }) =>
    request<{ asset: Asset }>(`/api/qa/messages/${messageId}/capture`, { method: "POST", body: JSON.stringify(body) }),
  insights: (workspaceId: string) => request<{ questions: InsightItem[]; documents: InsightItem[] }>(`/api/analytics/insights?workspaceId=${encodeURIComponent(workspaceId)}`),
  inspectWeb: (workspaceId: string, url: string, persist = false) => request<{ page: { title: string; url: string; snippet: string }; asset?: Asset }>("/api/web/inspect", { method: "POST", body: JSON.stringify({ workspaceId, url, persist }) }),
  categories: (workspaceId: string) => request<{ categories: Category[] }>(`/api/workspaces/${workspaceId}/categories`),
  createCategory: (workspaceId: string, name: string, parentId?: string | null) => request<{ category: Category }>(`/api/workspaces/${workspaceId}/categories`, { method: "POST", body: JSON.stringify({ name, parentId }) }),
  updateCategory: (workspaceId: string, categoryId: string, body: { name?: string; sortOrder?: number }) => request<{ category: Category }>(`/api/workspaces/${workspaceId}/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCategory: (workspaceId: string, categoryId: string) => request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/categories/${categoryId}`, { method: "DELETE" }),
  products: (workspaceId: string, categoryId?: string) => request<{ products: Product[] }>(`/api/workspaces/${workspaceId}/products${categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : ""}`),
  createProduct: (workspaceId: string, categoryId: string, name: string) => request<{ product: Product }>(`/api/workspaces/${workspaceId}/products`, { method: "POST", body: JSON.stringify({ categoryId, name }) }),
  updateProduct: (workspaceId: string, productId: string, body: { name?: string; categoryId?: string; sortOrder?: number }) => request<{ product: Product }>(`/api/workspaces/${workspaceId}/products/${productId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProduct: (workspaceId: string, productId: string) => request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/products/${productId}`, { method: "DELETE" }),
  imageSearchText: (workspaceId: string, query: string) => request<{ assets: Asset[] }>("/api/image-search/text", { method: "POST", body: JSON.stringify({ workspaceId, query }) }),
  imageSearchImage: (workspaceId: string, file: File) => {
    const body = new FormData();
    body.append("workspaceId", workspaceId);
    body.append("file", file);
    return request<{ assets: Asset[] }>("/api/image-search/image", { method: "POST", body });
  },
  noteFolders: (workspaceId: string) => request<{ folders: NoteFolder[] }>(`/api/note-folders?workspaceId=${encodeURIComponent(workspaceId)}`),
  createNoteFolder: (workspaceId: string, name: string, parentId?: string | null) => request<{ folder: NoteFolder }>("/api/note-folders", { method: "POST", body: JSON.stringify({ workspaceId, name, parentId }) }),
  notes: (workspaceId: string, options: { folderId?: string; search?: string; deleted?: boolean; favorite?: boolean } = {}) => {
    const params = new URLSearchParams({ workspaceId });
    if (options.folderId) params.set("folderId", options.folderId);
    if (options.search) params.set("search", options.search);
    if (options.deleted) params.set("deleted", "true");
    if (options.favorite) params.set("favorite", "true");
    return request<{ notes: Note[] }>(`/api/notes?${params}`);
  },
  note: (id: string) => request<{ note: Note }>(`/api/notes/${id}`),
  createNote: (body: { workspaceId: string; folderId?: string | null; title: string; content?: string; contentJson?: Record<string, unknown>; tags?: string[] }) => request<{ note: Note }>("/api/notes", { method: "POST", body: JSON.stringify(body) }),
  createNoteFromAsset: (assetId: string, folderId?: string | null) => request<{ note: Note; created: boolean }>(`/api/assets/${assetId}/open-in-notes`, { method: "POST", body: JSON.stringify({ folderId }) }),
  updateNote: (id: string, body: { expectedVersion: number; title?: string; content?: string; contentJson?: Record<string, unknown>; folderId?: string | null; tags?: string[]; favorite?: boolean; autoPublish?: boolean }) => request<{ note: Note }>(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  publishNote: (id: string) => request<{ note: Note; asset: Asset | null; revision: NoteRevision | null; unchanged: boolean }>(`/api/notes/${id}/publish`, { method: "POST" }),
  deleteNote: (id: string) => request<{ ok: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),
  purgeNote: (id: string) => request<{ ok: boolean }>(`/api/notes/${id}/permanent`, { method: "DELETE" }),
  restoreNote: (id: string) => request<{ note: Note }>(`/api/notes/${id}/restore`, { method: "POST" }),
  noteLifecycle: (id: string) => request<NoteLifecycle>(`/api/notes/${id}/lifecycle`),
  revertNote: (id: string, versionId: number) => request<{ note: Note }>(`/api/notes/${id}/revert`, { method: "POST", body: JSON.stringify({ versionId }) }),
  extractNoteFacts: (id: string) => request<{ facts: NoteFact[] }>(`/api/notes/${id}/extract-facts`, { method: "POST" }),
  noteOverview: (id: string, body: { title?: string; content?: string; locale: "zh-CN" | "en-US" }) => request<{ overview: NoteOverview }>(`/api/notes/${id}/overview`, { method: "POST", body: JSON.stringify(body) }),
  optimizeNote: (id: string, body: { title?: string; content?: string; modelId?: string; locale: "zh-CN" | "en-US" }) =>
    request<{ markdown: string }>(`/api/notes/${id}/optimize`, { method: "POST", body: JSON.stringify(body) }),
  facts: (workspaceId: string, status?: NoteFact["status"], noteId?: string) => {
    const params = new URLSearchParams({ workspaceId });
    if (status) params.set("status", status);
    if (noteId) params.set("noteId", noteId);
    return request<{ facts: NoteFact[] }>(`/api/facts?${params}`);
  },
  verifyFact: (id: string) => request<{ fact: NoteFact }>(`/api/facts/${id}/verify`, { method: "POST" }),
  correctFact: (id: string, fact: string) => request<{ fact: NoteFact }>(`/api/facts/${id}/correct`, { method: "POST", body: JSON.stringify({ fact }) }),
  forgetFact: (id: string) => request<{ fact: NoteFact }>(`/api/facts/${id}/forget`, { method: "POST" }),
  gbrainSeeds: (workspaceId: string) => request<{ seeds: GBrainSeed[] }>(`/api/gbrain/seeds?workspaceId=${encodeURIComponent(workspaceId)}`),
  gbrainGraph: (workspaceId: string, slug: string, depth = 3) => request<GBrainGraphDetail>(`/api/gbrain/graph?workspaceId=${encodeURIComponent(workspaceId)}&slug=${encodeURIComponent(slug)}&depth=${depth}`),
  gbrainIntelligence: (workspaceId: string, options: { topic?: string; slug?: string; severity?: string } = {}) => {
    const params = new URLSearchParams({ workspaceId });
    if (options.topic) params.set("topic", options.topic);
    if (options.slug) params.set("slug", options.slug);
    if (options.severity) params.set("severity", options.severity);
    return request<GBrainIntelligence>(`/api/gbrain/intelligence?${params}`);
  },
  proposeOntology: (body: { workspaceId: string; entity: string; dimension: string; value: string; confidence: number; visibility?: "private" | "world" }) =>
    request<{ observation: GBrainObject }>("/api/gbrain/ontology", { method: "POST", body: JSON.stringify(body) }),
  gbrainOperations: () => request<GBrainOperations>("/api/gbrain/operations"),
  retryGBrainJob: (id: number) => request<{ job: GBrainObject }>(`/api/gbrain/jobs/${id}/retry`, { method: "POST" }),
  cancelGBrainJob: (id: number) => request<{ job: GBrainObject }>(`/api/gbrain/jobs/${id}/cancel`, { method: "POST" }),
  gbrainGovernance: () => request<GBrainGovernance>("/api/gbrain/governance"),
  gbrainSkill: (name: string, sourceId?: string) => request<{ skill: { available: boolean; data: GBrainObject | null; error?: string } }>(`/api/gbrain/skills/${encodeURIComponent(name)}${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`),
  streamNoteAssist,
  streamOptimizeNote
};
