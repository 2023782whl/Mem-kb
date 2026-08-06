import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { parseDocument } from "./parser.js";

export interface DocumentProcessorInput {
  assetId: string;
  tenantId: string;
  userId: string;
  filename: string;
  mimeType: string;
  absolutePath: string;
  sourceUrl: string;
}

export interface DocumentProcessorResult {
  markdown: string;
  indexMarkdown?: string;
  summary: string;
  provider: "eopera" | "native" | "native-fallback";
  version: string;
  warning?: string;
}

export interface DocumentProcessor {
  process(input: DocumentProcessorInput): Promise<DocumentProcessorResult>;
}

const responseSchema = z.object({
  message: z.string(),
  data: z.array(z.object({
    doc_id: z.string(),
    status: z.string(),
    current_version: z.string().nullable(),
    markdown_content: z.string().nullable(),
    display_markdown: z.string().nullable().optional(),
    index_markdown: z.string().nullable().optional()
  }))
});

function summarize(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#>*_`|\[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export class NativeDocumentProcessor implements DocumentProcessor {
  async process(input: DocumentProcessorInput): Promise<DocumentProcessorResult> {
    const parsed = await parseDocument(input.absolutePath, input.filename, input.mimeType);
    return {
      markdown: parsed.text,
      summary: parsed.summary,
      provider: "native",
      version: "aiteam-native-v1"
    };
  }
}

export class EOperaDocumentProcessor implements DocumentProcessor {
  async process(input: DocumentProcessorInput): Promise<DocumentProcessorResult> {
    const endpoint = new URL(env.documentProcessor.endpoint, `${env.documentProcessor.baseUrl.replace(/\/$/, "")}/`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Tenant-ID": input.tenantId,
        "X-User-ID": input.userId
      },
      body: JSON.stringify({
        files: [{
          doc_id: input.assetId,
          filename: input.filename,
          oss_url: input.sourceUrl,
          parent_id: null
        }]
      }),
      signal: AbortSignal.timeout(env.documentProcessor.timeoutMs)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`EOpera 文档解析失败 (${response.status}): ${raw.slice(0, 300)}`);
    const payload = responseSchema.parse(JSON.parse(raw));
    const item = payload.data.find((entry) => entry.doc_id === input.assetId) || payload.data[0];
    const displayMarkdown = item?.display_markdown?.trim() || item?.markdown_content?.trim();
    if (!item || item.status !== "completed" || !displayMarkdown) {
      throw new Error(`EOpera 未返回有效 Markdown: ${input.filename}`);
    }
    return {
      markdown: displayMarkdown,
      indexMarkdown: item.index_markdown?.trim() || undefined,
      summary: summarize(displayMarkdown),
      provider: "eopera",
      version: item.current_version || "unknown"
    };
  }
}

function shouldUseNativeDirectly(filename: string) {
  return [".md", ".markdown", ".txt"].includes(path.extname(filename).toLowerCase());
}

function supportsNativeFallback(filename: string) {
  return [".md", ".markdown", ".txt", ".csv", ".pdf", ".docx", ".xlsx"].includes(path.extname(filename).toLowerCase());
}

export async function processDocument(input: DocumentProcessorInput): Promise<DocumentProcessorResult> {
  const native = new NativeDocumentProcessor();
  if (env.documentProcessor.mode === "native" || !env.documentProcessor.baseUrl || shouldUseNativeDirectly(input.filename)) {
    return native.process(input);
  }
  try {
    return await new EOperaDocumentProcessor().process(input);
  } catch (error) {
    if (env.documentProcessor.mode === "eopera") throw error;
    if (!supportsNativeFallback(input.filename)) {
      throw new Error(`该格式必须使用 EOperaAgent 解析：${error instanceof Error ? error.message : "服务不可用"}`);
    }
    const fallback = await native.process(input);
    return {
      ...fallback,
      provider: "native-fallback",
      warning: error instanceof Error ? error.message : "EOpera 文档解析不可用"
    };
  }
}
