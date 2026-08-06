import fs from "node:fs/promises";
import { env } from "../config/env.js";
import { completeModel, streamModel } from "../modules/models/protocols.js";
import { resolveRuntimeModel } from "../modules/models/runtime.js";
import type { ModelMessage } from "../modules/models/types.js";

export interface ModelCitation {
  title: string;
  snippet: string;
  slug?: string | null;
  kind?: "document" | "image" | "web";
  url?: string | null;
}

export interface AskInput {
  tenantId?: string;
  question: string;
  workspaceName: string;
  modelId?: string;
  context: string;
  citations: ModelCitation[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface NoteAssistantInput {
  tenantId?: string;
  action: "continue" | "rewrite" | "summarize" | "outline" | "custom";
  instruction: string;
  title: string;
  markdown: string;
  selection?: string;
  context?: string;
  modelId?: string;
  locale?: "zh-CN" | "en-US";
}

export interface NoteOptimizeInput {
  tenantId?: string;
  title: string;
  markdown: string;
  modelId?: string;
  locale?: "zh-CN" | "en-US";
}

export type NoteOptimizeProgress =
  | { type: "start"; total: number }
  | { type: "chunk-start"; index: number; total: number }
  | { type: "chunk-reset"; index: number; total: number; markdown: string }
  | { type: "delta"; text: string; index: number; total: number }
  | { type: "chunk-done"; index: number; total: number }
  | { type: "done"; markdown: string; fallback: boolean };

export interface NoteOverview {
  summary: string;
  keyPoints: string[];
  suggestedQuestions: string[];
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

function knowledgeMessages(input: AskInput): ModelMessage[] {
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

export async function runKnowledgeAnswer(input: AskInput, signal?: AbortSignal) {
  if (env.model.mode === "mock") {
    return `基于当前知识库回答：${input.question}\n\n建议先把高频问题整理成 SOP，再沉淀到 Workspace 形成可复用资产。`;
  }
  const model = await resolveRuntimeModel(input.tenantId, input.modelId, "LLM");
  return (await completeModel(model, knowledgeMessages(input), { signal })).text;
}

export async function streamKnowledgeAnswer(input: AskInput, onDelta: (text: string) => void, signal?: AbortSignal) {
  if (env.model.mode === "mock") {
    const answer = await runKnowledgeAnswer(input);
    for (const part of answer.match(/.{1,10}/gs) || []) onDelta(part);
    return answer;
  }

  const model = await resolveRuntimeModel(input.tenantId, input.modelId, "LLM");
  return streamModel(model, knowledgeMessages(input), onDelta, { signal });
}

function noteAssistantMessages(input: NoteAssistantInput): ModelMessage[] {
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
      content: input.locale === "en-US"
        ? "You are the Mem-kb enterprise knowledge writing assistant. Answer in English. Output only Markdown that can be used directly in the editor, do not explain the operation, and never invent evidence."
        : "你是 Mem-kb 企业知识写作助手。使用中文回答。只输出可直接插入编辑器的 Markdown，不解释操作过程，不编造证据。"
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
  const model = await resolveRuntimeModel(input.tenantId, input.modelId, "LLM");
  return streamModel(model, noteAssistantMessages(input), onDelta, { signal });
}

const NOTE_STRUCTURE_OPTIMIZE_PROMPT = "在细节,和章节,内容不变的情况下,帮我重写,逻辑更清晰,而且层级更清晰,重写全文";
const NOTE_OPTIMIZE_CHUNK_CHARS = 28_000;
const NOTE_OPTIMIZE_RETRIES = 2;

function noteOptimizeMessages(input: NoteOptimizeInput, segment?: { index: number; total: number; content: string }): ModelMessage[] {
  const english = input.locale === "en-US";
  const source = segment?.content ?? input.markdown;
  return [
    {
      role: "system",
      content: english
        ? "You are a senior enterprise knowledge editor. Output only clean Markdown, without code fences or explanations. Preserve all factual details, sections, numbers, names, and source meaning. Improve structure, hierarchy, and logic without inventing information."
        : "你是资深企业知识编辑。只输出干净 Markdown，不要代码围栏，不要解释过程。保留所有事实细节、章节、数字、名称和原意，只优化结构、层级与逻辑，不编造信息。"
    },
    {
      role: "user",
      content: [
        `# 任务\n${NOTE_STRUCTURE_OPTIMIZE_PROMPT}`,
        segment ? `# 分段\n全文较长，这是第 ${segment.index + 1}/${segment.total} 段。只重写本段，保持与全文连续，不要补写其他段。` : "",
        `# 文档标题\n${input.title}`,
        "# 原文 Markdown",
        source
      ].filter(Boolean).join("\n\n")
    }
  ];
}

export async function optimizeNoteContent(input: NoteOptimizeInput, signal?: AbortSignal) {
  let markdown = "";
  await streamOptimizeNoteContent(input, (event) => {
    if (event.type === "delta") markdown += event.text;
    if (event.type === "chunk-reset") markdown = event.markdown;
    if (event.type === "done" && !markdown.trim()) markdown = event.markdown;
  }, signal);
  return { markdown: normalizeOptimizedMarkdown(markdown || input.markdown || `# ${input.title}`) };
}

export async function streamOptimizeNoteContent(input: NoteOptimizeInput, onProgress: (event: NoteOptimizeProgress) => void, signal?: AbortSignal) {
  const fallbackSource = normalizeOptimizedMarkdown(input.markdown || `# ${input.title}`);
  if (env.model.mode === "mock") {
    onProgress({ type: "start", total: 1 });
    await emitText(fallbackSource, (text) => onProgress({ type: "delta", text, index: 0, total: 1 }));
    onProgress({ type: "done", markdown: fallbackSource, fallback: false });
    return fallbackSource;
  }

  const model = await resolveRuntimeModel(input.tenantId, input.modelId, "LLM");
  const chunks = splitMarkdownForOptimization(fallbackSource);
  const optimized: string[] = [];
  let usedFallback = false;
  onProgress({ type: "start", total: chunks.length });

  for (const [index, content] of chunks.entries()) {
    const total = chunks.length;
    onProgress({ type: "chunk-start", index, total });
    const result = await optimizeChunkWithRetry(model, input, content, index, total, (text) => {
      onProgress({ type: "delta", text, index, total });
    }, () => {
      const committed = optimized.length ? `${optimized.join("\n\n")}\n\n` : "";
      onProgress({ type: "chunk-reset", index, total, markdown: committed });
    }, signal);
    optimized.push(result.markdown);
    usedFallback ||= result.fallback;
    onProgress({ type: "chunk-done", index, total });
    if (index < chunks.length - 1) onProgress({ type: "delta", text: "\n\n", index, total });
  }

  const markdown = normalizeOptimizedMarkdown(optimized.join("\n\n")) || fallbackSource;
  onProgress({ type: "done", markdown, fallback: usedFallback || !markdown.trim() });
  return markdown;
}

async function optimizeChunkWithRetry(
  model: Awaited<ReturnType<typeof resolveRuntimeModel>>,
  input: NoteOptimizeInput,
  content: string,
  index: number,
  total: number,
  onDelta: (text: string) => void,
  onReset: () => void,
  signal?: AbortSignal
) {
  for (let attempt = 0; attempt <= NOTE_OPTIMIZE_RETRIES; attempt += 1) {
    let answer = "";
    let emitted = false;
    try {
      await streamModel(
        model,
        noteOptimizeMessages(input, total > 1 ? { index, total, content } : undefined),
        (text) => {
          answer += text;
          emitted = true;
          onDelta(text);
        },
        { signal, temperature: Math.min(model.temperature, 0.25), maxTokens: model.maxTokens }
      );
      const markdown = normalizeOptimizedMarkdown(answer);
      if (markdown) return { markdown, fallback: false };
      if (emitted) onReset();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (emitted) onReset();
      if (attempt >= NOTE_OPTIMIZE_RETRIES) break;
    }
  }

  const fallback = normalizeOptimizedMarkdown(content);
  await emitText(fallback, onDelta);
  return { markdown: fallback, fallback: true };
}

async function emitText(text: string, onDelta: (text: string) => void) {
  for (const part of text.match(/[\s\S]{1,240}/g) || []) {
    onDelta(part);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function splitMarkdownForOptimization(markdown: string) {
  const source = markdown.trim();
  if (source.length <= NOTE_OPTIMIZE_CHUNK_CHARS) return [source];
  const sections = source.split(/(?=^#{1,2}\s+)/gm).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const section of sections.length ? sections : source.split(/\n{2,}/)) {
    if (section.length > NOTE_OPTIMIZE_CHUNK_CHARS) {
      if (current.trim()) chunks.push(current.trim());
      chunks.push(...splitLongSection(section));
      current = "";
      continue;
    }
    if ((current + "\n\n" + section).length > NOTE_OPTIMIZE_CHUNK_CHARS) {
      if (current.trim()) chunks.push(current.trim());
      current = section;
    } else {
      current = current ? `${current}\n\n${section}` : section;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [source.slice(0, NOTE_OPTIMIZE_CHUNK_CHARS)];
}

function splitLongSection(section: string) {
  const chunks: string[] = [];
  for (let index = 0; index < section.length; index += NOTE_OPTIMIZE_CHUNK_CHARS) {
    chunks.push(section.slice(index, index + NOTE_OPTIMIZE_CHUNK_CHARS).trim());
  }
  return chunks.filter(Boolean);
}

function normalizeOptimizedMarkdown(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:markdown|md|text)?[^\n]*\n([\s\S]*?)\n```\s*$/i)?.[1];
  return (fenced || trimmed).replace(/\r\n?/g, "\n").trim();
}

function fallbackOverviewPoints(markdown: string, locale: "zh-CN" | "en-US") {
  const headings = Array.from(markdown.matchAll(/^#{1,3}\s+(.+)$/gm))
    .map((match) => plainText(match[1]))
    .filter(Boolean);
  const bullets = Array.from(markdown.matchAll(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)(.+)$/gm))
    .map((match) => plainText(match[1]))
    .filter((item) => item.length >= 6);
  const sentences = plainText(markdown).split(locale === "en-US" ? /(?<=[.!?])\s+/ : /(?<=[。！？])/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  return [...new Set([...headings, ...bullets, ...sentences])].slice(0, 5);
}

function fallbackOverviewQuestions(title: string, points: string[], locale: "zh-CN" | "en-US") {
  const subjects = [...new Set(points.map((point) => point.replace(/[：:。.!?？]/g, " ").trim()).filter(Boolean))];
  if (locale === "en-US") {
    return [
      subjects[0] ? `What are the key steps and success criteria for ${subjects[0]}?` : `What are the key actions in ${title}?`,
      subjects[1] ? `How should ${subjects[1]} be implemented and measured?` : `What risks should I watch for when applying ${title}?`,
      subjects[2] ? `How can ${subjects[2]} be turned into a reusable workflow?` : `How can I turn ${title} into a reusable workflow?`
    ];
  }
  return [
    subjects[0] ? `${subjects[0]}的关键步骤和成功标准是什么？` : `${title}中最关键的执行动作是什么？`,
    subjects[1] ? `应该如何落地并衡量${subjects[1]}？` : `落地${title}时需要注意哪些风险？`,
    subjects[2] ? `如何把${subjects[2]}沉淀为可复用流程？` : `如何把${title}沉淀为可复用流程？`
  ];
}

export function normalizeNoteOverview(
  input: Partial<NoteOverview>,
  title: string,
  markdown: string,
  locale: "zh-CN" | "en-US" = "zh-CN"
): NoteOverview {
  const fallbackPoints = fallbackOverviewPoints(markdown, locale);
  const modelPoints = Array.isArray(input.keyPoints)
    ? input.keyPoints.map((item) => plainText(String(item))).filter(Boolean)
    : [];
  const keyPoints = [...new Set([...modelPoints, ...fallbackPoints])].slice(0, 5);
  const fallbackQuestions = fallbackOverviewQuestions(title, keyPoints, locale);
  const modelQuestions = Array.isArray(input.suggestedQuestions)
    ? input.suggestedQuestions.map((item) => plainText(String(item))).filter(Boolean)
    : [];
  const suggestedQuestions = [...new Set([...modelQuestions, ...fallbackQuestions])].slice(0, 3);
  return {
    summary: plainText(String(input.summary || "")) || fallbackSummary(markdown) || (locale === "en-US" ? "This note does not have enough content to summarize yet." : "当前笔记内容较少，暂时无法生成完整概览。"),
    keyPoints,
    suggestedQuestions
  };
}

export async function generateNoteOverview(input: {
  tenantId?: string;
  title: string;
  markdown: string;
  locale?: "zh-CN" | "en-US";
}): Promise<NoteOverview> {
  const locale = input.locale || "zh-CN";
  if (env.model.mode === "mock") return normalizeNoteOverview({}, input.title, input.markdown, locale);
  const model = await resolveRuntimeModel(input.tenantId, undefined, "LLM");
  const english = locale === "en-US";
  const payload = await completeModel(model, [
    {
      role: "system",
      content: english
        ? "You create concise AI overviews for enterprise notes. Return valid JSON only, write in English, and never invent information not present in the note."
        : "你为企业笔记生成简洁、准确的 AI 概览。只输出合法 JSON，使用中文，不得编造笔记中不存在的信息。"
    },
    {
      role: "user",
      content: [
        `${english ? "Title" : "标题"}: ${input.title}`,
        input.markdown.slice(0, 60_000),
        english
          ? "Return a complete 2-3 sentence summary, 3-5 concise key points, and exactly 3 specific follow-up questions that help the reader understand or apply this note. Questions must be grounded in this note and suitable for asking an assistant with the current note as context."
          : "输出完整的 2～3 句摘要、3～5 条简明关键要点，以及恰好 3 个帮助读者理解或应用当前笔记的具体追问。问题必须基于当前笔记，适合直接交给携带当前笔记上下文的助手回答。",
        '{"summary":"...","keyPoints":["..."],"suggestedQuestions":["..."]}'
      ].join("\n\n")
    }
  ], { maxTokens: 1800, json: true });
  return normalizeNoteOverview(parseJsonObject<Partial<NoteOverview>>(payload.text), input.title, input.markdown, locale);
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

export async function extractKnowledgeGraph(title: string, markdown: string, tenantId?: string): Promise<ExtractedGraph> {
  if (env.model.mode === "mock") {
    return normalizeDocumentAnalysis({
      summary: fallbackSummary(markdown),
      tags: ["企业知识", "运营方法", "知识沉淀", "业务资料", "可复用内容"],
      topics: []
    }, title, markdown);
  }
  const model = await resolveRuntimeModel(tenantId, undefined, "LLM");
  const payload = await completeModel(model, [
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
    ], { maxTokens: 2200, json: true });
  const parsed = parseJsonObject<Partial<ExtractedGraph>>(payload.text);
  return normalizeDocumentAnalysis(parsed, title, markdown);
}

export async function describeImage(filePath: string, mimeType: string, tenantId?: string): Promise<VisionDescription> {
  if (env.model.mode === "mock") {
    return { summary: "商品素材图片，适合用于电商运营场景。", ocr: "", scene: "电商商品展示", product: "商品", sellingPoints: ["清晰展示"], style: "简洁", tags: ["商品", "素材"] };
  }
  const model = await resolveRuntimeModel(tenantId, undefined, "IMAGE");
  const dataUrl = `data:${mimeType};base64,${(await fs.readFile(filePath)).toString("base64")}`;
  const payload = await completeModel(model, [
      { role: "system", content: "你是电商图片资产分析师，只输出合法 JSON。" },
      {
        role: "user",
        content: [
          { type: "text", text: "分析图片，输出 summary(约100字)、ocr、scene、product、sellingPoints数组、style、tags数组。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ], { maxTokens: 1600, json: true });
  const parsed = parseJsonObject<Partial<VisionDescription>>(payload.text);
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
