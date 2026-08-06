import crypto from "node:crypto";
import fs from "node:fs/promises";
import sharp from "sharp";
import { env } from "../config/env.js";
import { resilientFetch } from "../services/outbound.js";

type EmbeddingResponse = {
  output?: { embeddings?: Array<{ embedding?: number[] }> };
  code?: string;
  message?: string;
};

function mockVector(value: string) {
  const bytes = crypto.createHash("sha256").update(value).digest();
  return Array.from({ length: 1024 }, (_, index) => (bytes[index % bytes.length] - 127.5) / 127.5);
}

async function imageDataUrl(filePath: string) {
  const buffer = await sharp(await fs.readFile(filePath)).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

export async function embedMultimodal(input: { text?: string; imagePath?: string }, signal?: AbortSignal) {
  if (!input.text && !input.imagePath) throw new Error("缺少向量输入");
  if (env.model.mode === "mock") return mockVector(input.text || input.imagePath || "mock");
  const apiKey = process.env[env.embedding.apiKeyEnv];
  if (!apiKey) throw new Error(`缺少多模态向量密钥：${env.embedding.apiKeyEnv}`);
  const contents: Array<Record<string, string>> = [];
  if (input.text) contents.push({ text: input.text.slice(0, 4000) });
  if (input.imagePath) contents.push({ image: await imageDataUrl(input.imagePath) });
  const response = await resilientFetch(`embedding:${new URL(env.embedding.multimodalUrl).origin}`, env.embedding.multimodalUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: env.embedding.multimodalModel, input: { contents } })
  }, { timeoutMs: 60_000, maxAttempts: 2, signal });
  const payload = (await response.json()) as EmbeddingResponse;
  const vector = payload.output?.embeddings?.[0]?.embedding;
  if (!response.ok || !vector?.length) throw new Error(payload.message || payload.code || "多模态向量生成失败");
  if (vector.length !== 1024) throw new Error(`向量维度不匹配：期望 1024，实际 ${vector.length}`);
  return vector;
}

export function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}
