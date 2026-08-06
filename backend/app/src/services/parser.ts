import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import TurndownService from "turndown";

export interface ParsedDocument {
  title: string;
  text: string;
  summary: string;
}

const require = createRequire(import.meta.url);
const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

function cleanText(value: string) {
  return value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function summarize(text: string) {
  const compact = cleanText(text).replace(/\s+/g, " ");
  return compact.slice(0, 100);
}

function markdownTable(rows: unknown[][]) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) return "";
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")));
  const header = normalized[0].some(Boolean) ? normalized[0] : Array.from({ length: width }, (_, index) => `Col${index + 1}`);
  const body = normalized[0].some(Boolean) ? normalized.slice(1) : normalized;
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

export async function parseDocument(filePath: string, originalName: string, mimeType: string): Promise<ParsedDocument> {
  const ext = path.extname(originalName).toLowerCase();
  let text = "";

  if (mimeType.startsWith("text/") || [".md", ".markdown", ".txt", ".csv"].includes(ext)) {
    text = await fs.readFile(filePath, "utf8");
  } else if (ext === ".pdf" || mimeType === "application/pdf") {
    const pdfParse = await import("pdf-parse");
    const buffer = await fs.readFile(filePath);
    const parse = (pdfParse as unknown as { default?: (data: Buffer) => Promise<{ text: string }> }).default;
    if (!parse) throw new Error("PDF 解析器不可用");
    const parsed = await parse(buffer);
    text = parsed.text;
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.convertToHtml({ path: filePath });
    text = turndown.turndown(parsed.value);
  } else if (ext === ".xlsx") {
    const readXlsxFile = require("read-excel-file/node") as (filePath: string) => Promise<unknown[][]>;
    const rows = await readXlsxFile(filePath);
    text = markdownTable(rows);
  } else {
    throw new Error(`不支持解析文件格式：${ext || mimeType}`);
  }

  const normalized = cleanText(text);
  return {
    title: originalName.replace(/\.[^.]+$/, ""),
    text: normalized,
    summary: summarize(normalized || originalName)
  };
}

export function buildMarkdownPage(input: {
  title: string;
  body: string;
  tenantId: string;
  workspaceId: string;
  assetId: string;
  source: string;
  sha256?: string;
  citations?: Array<{ title: string; snippet: string; slug?: string | null }>;
}) {
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(input.title)}`,
    `tenant_id: ${JSON.stringify(input.tenantId)}`,
    `workspace_id: ${JSON.stringify(input.workspaceId)}`,
    `asset_id: ${JSON.stringify(input.assetId)}`,
    `source: ${JSON.stringify(input.source)}`,
    input.sha256 ? `sha256: ${JSON.stringify(input.sha256)}` : "",
    "---"
  ].filter(Boolean);

  const citations = input.citations?.length
    ? ["", "## 来源引用", ...input.citations.map((item) => `- ${item.title}: ${item.snippet}${item.slug ? ` (${item.slug})` : ""}`)]
    : [];

  return [...frontmatter, "", `# ${input.title}`, "", input.body, ...citations].join("\n");
}
