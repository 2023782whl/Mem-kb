import fs from "node:fs/promises";
import { env } from "../config/env.js";
import { findModel, type RuntimeModel } from "../config/models.js";

export interface ModelCitation {
  title: string;
  snippet: string;
  slug?: string | null;
  kind?: "document" | "image" | "web";
  url?: string | null;
}

export interface AskInput {
  question: string;
  workspaceName: string;
  modelId?: string;
  context: string;
  citations: ModelCitation[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface NoteAssistantInput {
  action: "continue" | "rewrite" | "summarize" | "outline" | "custom";
  instruction: string;
  title: string;
  markdown: string;
  selection?: string;
  context?: string;
  modelId?: string;
}

export interface ExtractedGraph {
  summary: string;
  tags: string[];
  topics: Array<{ label: string; type: string; relation: string; evidence: string }>;
}

export interface VisionDescription {
  summary: string;
  ocr: string;
  scene: string;
  product: string;
  sellingPoints: string[];
  style: string;
  tags: string[];
}

type ChatPayload = {
  choices?: Array<{
    text?: string;
    delta?: { content?: string };
    message?: { content?: string | Array<{ type?: string; text?: string }>; reasoning_content?: string };
  }>;
  output_text?: string;
  error?: { message?: string };
  raw?: string;
};

function extractContent(payload: ChatPayload) {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  if (typeof message?.content === "string" && message.content.trim()) return message.content.trim();
  if (Array.isArray(message?.content)) {
    const text = message.content.map((item) => item.text || "").join("").trim();
    if (text) return text;
  }
  return message?.reasoning_content?.trim() || choice?.text?.trim() || payload.output_text?.trim() || "";
}

export function resolveModel(idOrName?: string, kind?: RuntimeModel["kind"]) {
  const requested = findModel(env.model.models, idOrName || env.model.id);
  if (requested && (!kind || requested.kind === kind)) return requested;
  return env.model.models.find((model) => model.kind === kind && Boolean(process.env[model.apiKeyEnv])) || env.model.selected;
}

function modelKey(model: RuntimeModel) {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) throw new Error(`缺少模型密钥环境变量：${model.apiKeyEnv}`);
  return apiKey;
}

async function requestChat(model: RuntimeModel, body: Record<string, unknown>, timeoutMs = 90_000) {
  const endpoint = `${model.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${modelKey(model)}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = (await response.json().catch(async () => ({ raw: await response.text() }))) as ChatPayload;
      if (!response.ok) {
        const error = new Error(payload.error?.message || payload.raw || `模型请求失败：${response.status}`) as Error & { retryable?: boolean };
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof Error && "retryable" in error) || Boolean((error as Error & { retryable?: boolean }).retryable);
      if (attempt === 2 || !retryable) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw modelNetworkError(model, lastError);
}

function modelNetworkError(model: RuntimeModel, error: unknown) {
  if (error instanceof Error && "retryable" in error) return error;
  const cause = error instanceof Error ? error.cause : undefined;
  const detail = cause instanceof Error
    ? `${cause.name}: ${cause.message}${"code" in cause ? ` (${String(cause.code)})` : ""}`
    : error instanceof Error ? `${error.name}: ${error.message}` : String(error || "unknown_error");
  let host = model.baseUrl;
  try { host = new URL(model.baseUrl).host; } catch { /* Keep the configured URL. */ }
  return new Error(`模型网关连接失败（${host}）：${detail}`, { cause: error });
}

function knowledgeMessages(input: AskInput) {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let remainingHistoryChars = 18_000;
  for (const message of [...(input.history || [])].reverse()) {
    if (remainingHistoryChars <= 0) break;
    const content = message.content.slice(0, Math.min(6_000, remainingHistoryChars));
    history.unshift({ role: message.role, content });
    remainingHistoryChars -= content.length;
  }
  return [
    {
      role: "system",
      content: "你是 Mem-kb 企业运营知识助手。必须使用中文，回答可执行且引用明确；上下文不足时说明缺口，禁止编造。"
    },
    ...history,
    {
      role: "user",
      content: [
        `# Workspace\n${input.workspaceName}`,
        `# 知识与联网证据\n${input.context || "暂无可用上下文。"}`,
        `# 用户问题\n${input.question}`,
        "像专业助手一样直接回答问题，不强制套用固定章节模板；需要结构时自然使用 Markdown。引用资料时使用 [序号]。"
      ].join("\n\n")
    }
  ];
}

export async function runKnowledgeAnswer(input: AskInput) {
  if (env.model.mode === "mock") {
    return `基于当前知识库回答：${input.question}\n\n建议先把高频问题整理成 SOP，再沉淀到 Workspace 形成可复用资产。`;
  }
  const model = resolveModel(input.modelId, "LLM");
  const base = { model: model.modelName, messages: knowledgeMessages(input) };
  const first = extractContent(await requestChat(model, { ...base, max_completion_tokens: model.maxTokens }));
  if (first) return first;
  const retry = extractContent(await requestChat(model, { ...base, max_tokens: model.maxTokens }));
  if (!retry) throw new Error("模型返回为空");
  return retry;
}

export async function streamKnowledgeAnswer(input: AskInput, onDelta: (text: string) => void, signal?: AbortSignal) {
  if (env.model.mode === "mock") {
    const answer = await runKnowledgeAnswer(input);
    for (const part of answer.match(/.{1,10}/gs) || []) onDelta(part);
    return answer;
  }

  const model = resolveModel(input.modelId, "LLM");
  const response = await fetch(`${model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${modelKey(model)}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model.modelName,
      messages: knowledgeMessages(input),
      max_completion_tokens: model.maxTokens,
      stream: true
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  });
  if (!response.ok || !response.body) throw new Error((await response.text()) || `模型流式请求失败：${response.status}`);

  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const raw = line.trim();
      if (!raw.startsWith("data:") || raw === "data: [DONE]") continue;
      try {
        const payload = JSON.parse(raw.slice(5).trim()) as ChatPayload;
        const delta = payload.choices?.[0]?.delta?.content || "";
        if (delta) {
          answer += delta;
          onDelta(delta);
        }
      } catch {
        // Ignore provider keep-alive frames.
      }
    }
  }
  if (!answer.trim()) throw new Error("模型流式返回为空");
  return answer;
}

function noteAssistantMessages(input: NoteAssistantInput) {
  const actionText = {
    continue: "续写当前内容",
    rewrite: "重写选中内容，使表达更清晰专业",
    summarize: "总结当前内容",
    outline: "生成结构清晰的文章大纲",
    custom: input.instruction || "按用户要求处理"
  }[input.action];
  return [
    {
      role: "system",
      content: "你是 Mem-kb 企业知识写作助手。只输出可直接插入编辑器的 Markdown，不解释操作过程，不编造证据。"
    },
    {
      role: "user",
      content: [
        `# 任务\n${actionText}`,
        input.instruction ? `# 补充要求\n${input.instruction}` : "",
        `# 标题\n${input.title}`,
        input.selection ? `# 选中内容\n${input.selection}` : "",
        `# 当前笔记\n${input.markdown.slice(0, 80_000)}`,
        input.context ? `# 可引用上下文\n${input.context.slice(0, 50_000)}` : ""
      ].filter(Boolean).join("\n\n")
    }
  ];
}

export async function streamNoteAssistant(input: NoteAssistantInput, onDelta: (text: string) => void, signal?: AbortSignal) {
  if (env.model.mode === "mock") {
    const answer = input.selection || input.markdown || `## ${input.title}\n\n请补充笔记内容。`;
    for (const part of answer.match(/.{1,12}/gs) || []) onDelta(part);
    return answer;
  }
  const model = resolveModel(input.modelId, "LLM");
  const response = await fetch(`${model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${modelKey(model)}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: model.modelName,
      messages: noteAssistantMessages(input),
      max_completion_tokens: model.maxTokens,
      stream: true
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  });
  if (!response.ok || !response.body) throw new Error((await response.text()) || `模型流式请求失败：${response.status}`);

  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const raw = line.trim();
      if (!raw.startsWith("data:") || raw === "data: [DONE]") continue;
      try {
        const payload = JSON.parse(raw.slice(5).trim()) as ChatPayload;
        const delta = payload.choices?.[0]?.delta?.content || "";
        if (delta) {
          answer += delta;
          onDelta(delta);
        }
      } catch {
        // Providers may send keep-alive frames.
      }
    }
  }
  if (!answer.trim()) throw new Error("模型流式返回为空");
  return answer;
}

function parseJsonObject<T>(value: string): T {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  return JSON.parse(source) as T;
}

function plainText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`>~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackSummary(markdown: string) {
  const text = plainText(markdown);
  if (text.length <= 180) return text;
  const excerpt = text.slice(0, 180);
  const sentenceEnd = Math.max(excerpt.lastIndexOf("。"), excerpt.lastIndexOf("！"), excerpt.lastIndexOf("？"));
  return sentenceEnd >= 90 ? excerpt.slice(0, sentenceEnd + 1) : `${excerpt.trimEnd()}…`;
}

function normalizeTags(tags: unknown, topics: ExtractedGraph["topics"], title: string) {
  const titleTags = title
    .replace(/\.[^.]+$/, "")
    .split(/[\s_\-/—|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12);
  const candidates = [
    ...(Array.isArray(tags) ? tags : []),
    ...topics.map((topic) => topic.label),
    ...titleTags,
    "企业知识",
    "运营方法",
    "知识沉淀",
    "业务资料",
    "可复用内容"
  ];
  return [...new Set(candidates.map((item) => String(item).replace(/^#+|[，。；、]+$/g, "").trim()).filter(Boolean))].slice(0, 5);
}

export function normalizeDocumentAnalysis(
  input: Partial<ExtractedGraph>,
  title: string,
  markdown: string
): ExtractedGraph {
  const topics = Array.isArray(input.topics)
    ? input.topics
      .filter((topic) => topic && String(topic.label || "").trim())
      .map((topic) => ({
        label: String(topic.label).trim(),
        type: String(topic.type || "topic").trim() || "topic",
        relation: String(topic.relation || "主题关联").trim() || "主题关联",
        evidence: String(topic.evidence || "").trim()
      }))
      .slice(0, 8)
    : [];
  return {
    summary: plainText(String(input.summary || "")) || fallbackSummary(markdown),
    tags: normalizeTags(input.tags, topics, title),
    topics
  };
}

export async function extractKnowledgeGraph(title: string, markdown: string): Promise<ExtractedGraph> {
  if (env.model.mode === "mock") {
    return normalizeDocumentAnalysis({
      summary: fallbackSummary(markdown),
      tags: ["企业知识", "运营方法", "知识沉淀", "业务资料", "可复用内容"],
      topics: []
    }, title, markdown);
  }
  const model = resolveModel(undefined, "LLM");
  const payload = await requestChat(model, {
    model: model.modelName,
    messages: [
      { role: "system", content: "从企业运营文档抽取知识关系，只输出合法 JSON。" },
      {
        role: "user",
        content: [
          `文档：${title}`,
          markdown.slice(0, 40_000),
          "请理解全文后输出：",
          "1. summary：约 100～180 个中文字符，概括目标、核心内容和使用价值，必须是语义完整的纯文本，不复制 Markdown 标记，不在句中截断。",
          "2. tags：恰好 5 个互不重复的中文标签，每个 2～10 个字，体现业务领域、文档类型和核心主题。",
          "3. topics：最多 8 个可用于知识图谱的实体或主题。",
          '{"summary":"完整摘要","tags":["标签1","标签2","标签3","标签4","标签5"],"topics":[{"label":"实体或主题","type":"topic|sop|product|person|channel","relation":"关系","evidence":"原文证据"}]}'
        ].join("\n\n")
      }
    ],
    max_completion_tokens: 2200
  });
  const parsed = parseJsonObject<Partial<ExtractedGraph>>(extractContent(payload));
  return normalizeDocumentAnalysis(parsed, title, markdown);
}

export async function describeImage(filePath: string, mimeType: string): Promise<VisionDescription> {
  if (env.model.mode === "mock") {
    return { summary: "商品素材图片，适合用于电商运营场景。", ocr: "", scene: "电商商品展示", product: "商品", sellingPoints: ["清晰展示"], style: "简洁", tags: ["商品", "素材"] };
  }
  const model = resolveModel(undefined, "IMAGE");
  const dataUrl = `data:${mimeType};base64,${(await fs.readFile(filePath)).toString("base64")}`;
  const payload = await requestChat(model, {
    model: model.modelName,
    messages: [
      { role: "system", content: "你是电商图片资产分析师，只输出合法 JSON。" },
      {
        role: "user",
        content: [
          { type: "text", text: "分析图片，输出 summary(约100字)、ocr、scene、product、sellingPoints数组、style、tags数组。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ],
    max_completion_tokens: 1600
  });
  const parsed = parseJsonObject<Partial<VisionDescription>>(extractContent(payload));
  return {
    summary: String(parsed.summary || "").slice(0, 180),
    ocr: String(parsed.ocr || ""),
    scene: String(parsed.scene || ""),
    product: String(parsed.product || ""),
    sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints.map(String).slice(0, 8) : [],
    style: String(parsed.style || ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 12) : []
  };
}

export function modelCatalog() {
  return env.model.models.map((model) => ({
    id: model.id,
    name: model.name,
    modelName: model.modelName,
    kind: model.kind,
    iconUrl: model.iconUrl,
    capabilities: model.capabilities,
    maxTokens: model.maxTokens,
    supportsVision: model.supportsVision,
    configured: Boolean(process.env[model.apiKeyEnv]) || env.model.mode === "mock"
  }));
}
