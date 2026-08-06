import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env.js";
import { one, query } from "../db/pool.js";
import type { Asset, AssetMedia } from "../db/schema.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { createId } from "../utils/id.js";
import { IMAGE_FORMATS, matchesFileSignature } from "./document-formats.js";
import { assertPublicUrl } from "./public-url.js";
import { ensureStoredFile, removeStoredFile, writeStoredBuffer } from "./storage.js";

const markdownImagePattern = /!\[([^\]\n]*)\]\((data:image\/[^;\s)]+;base64,[A-Za-z0-9+/=\r\n]+|https?:\/\/[^\s)]+)\)/g;
const protectedMediaPattern = /!\[([^\]\n]*)\]\((\/api\/assets\/([^/\s)]+)\/media\/([^\s)]+))\)/g;
const anyMarkdownImagePattern = /!\[[^\]\n]*\]\([^)]+\)/g;
const maxRemoteBytes = 30 * 1024 * 1024;

export interface MaterializedMedia extends AssetMedia {
  absolutePath: string;
}

export interface MaterializedDocument {
  markdown: string;
  media: MaterializedMedia[];
}

interface ImagePayload {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  source: "embedded" | "eopera";
  sourceUrl?: string;
}

export async function materializeDocumentMedia(asset: Asset, markdown: string, importRemote: boolean): Promise<MaterializedDocument> {
  await query(`update asset_media set sequence = 2147483647 where asset_id = $1`, [asset.id]);
  const allReferences = [...markdown.matchAll(anyMarkdownImagePattern)];
  const sequenceByIndex = new Map(allReferences.map((match, index) => [match.index || 0, index]));
  const matches = [...markdown.matchAll(markdownImagePattern)];
  const media: MaterializedMedia[] = [];
  const activeIds = new Set<string>();
  const protectedMatches = [...markdown.matchAll(protectedMediaPattern)]
    .filter((match) => decodeURIComponent(match[3]) === asset.id);
  const protectedMedia = await mapWithConcurrency(
    protectedMatches,
    env.documentProcessor.mediaMaterializationConcurrency,
    async (match) => {
      const mediaId = decodeURIComponent(match[4]);
      const existing = await one<AssetMedia>(
        `update asset_media set sequence = $1, alt_text = $2, updated_at = now()
         where id = $3 and asset_id = $4 returning *`,
        [sequenceByIndex.get(match.index || 0) || 0, cleanAlt(match[1]), mediaId, asset.id]
      );
      if (!existing) return null;
      return { ...existing, absolutePath: await ensureStoredFile(existing.storage_key) };
    }
  );
  for (const existing of protectedMedia) {
    if (!existing || activeIds.has(existing.id)) continue;
    activeIds.add(existing.id);
    media.push(existing);
  }

  const replacements = await mapWithConcurrency(
    matches,
    env.documentProcessor.mediaMaterializationConcurrency,
    async (match) => {
      const sequence = sequenceByIndex.get(match.index || 0) || 0;
      const alt = cleanAlt(match[1] || `文档图片 ${sequence + 1}`);
      const source = match[2];
      const payload = source.startsWith("data:image/")
        ? decodeDataImage(source)
        : importRemote ? await downloadImage(source) : null;
      if (!payload) return { match, replacement: match[0], stored: null };
      const stored = await storeMedia(asset, payload, alt, sequence);
      return { match, replacement: `![${alt}](${documentMediaUrl(asset.id, stored.id)})`, stored };
    }
  );

  let output = "";
  let cursor = 0;
  for (const item of replacements) {
    output += markdown.slice(cursor, item.match.index);
    cursor = (item.match.index || 0) + item.match[0].length;
    output += item.replacement;
    const stored = item.stored;
    if (!stored) continue;
    const isNewReference = !activeIds.has(stored.id);
    activeIds.add(stored.id);
    if (isNewReference) media.push(stored);
  }
  output += markdown.slice(cursor);

  await removeStaleMedia(asset.id, activeIds);
  return {
    markdown: output,
    media: media.sort((left, right) => left.sequence - right.sequence)
  };
}

export async function storeIncomingDocumentMedia(asset: Asset, bytes: Buffer, mimeType: string, filename: string) {
  const declaredExtension = path.extname(filename).slice(1).toLowerCase();
  const extension = IMAGE_FORMATS.has(declaredExtension) ? declaredExtension : extensionForMime(mimeType);
  if (!IMAGE_FORMATS.has(extension) || !matchesFileSignature(bytes, extension)) {
    throw new Error("不支持的文档图片格式");
  }
  return storeMedia(asset, { bytes, mimeType, extension, source: "eopera" }, "文档图片", 2147483647);
}

export function documentMediaUrl(assetId: string, mediaId: string) {
  return `/api/assets/${encodeURIComponent(assetId)}/media/${encodeURIComponent(mediaId)}`;
}

export function countDataImages(markdown: string) {
  return (markdown.match(/data:image\//g) || []).length;
}

export function countProtectedMedia(markdown: string, assetId?: string) {
  return [...markdown.matchAll(protectedMediaPattern)].filter((match) => !assetId || decodeURIComponent(match[3]) === assetId).length;
}

export function buildIndexMarkdown(markdown: string, media: AssetMedia[]) {
  const byId = new Map(media.map((item) => [item.id, item]));
  return markdown.replace(protectedMediaPattern, (_full, alt: string, _url: string, _assetId: string, mediaId: string) => {
    const item = byId.get(decodeURIComponent(mediaId));
    const details = [item?.description, item?.ocr_text && `OCR：${item.ocr_text}`].filter(Boolean).join("；");
    return details ? `\n\n> 图片：${details}\n\n` : `\n\n> 图片：${alt || "文档图片"}\n\n`;
  });
}

async function storeMedia(asset: Asset, input: ImagePayload, alt: string, sequence: number) {
  const normalized = await normalizeImage(input);
  const sha256 = crypto.createHash("sha256").update(normalized.bytes).digest("hex");
  const storageKey = `document-media/${asset.id}/${sha256}.${normalized.extension}`;
  const existing = await one<AssetMedia>(`select * from asset_media where asset_id = $1 and sha256 = $2`, [asset.id, sha256]);
  if (existing) {
    const absolutePath = await ensureStoredFile(existing.storage_key)
      .catch(() => writeStoredBuffer(existing.storage_key, normalized.bytes));
    const row = await one<AssetMedia>(
      `update asset_media set sequence = least(sequence, $1),
       alt_text = case when alt_text = '' then $2 else alt_text end,
       anchor = $3::jsonb, metadata = metadata || $4::jsonb, updated_at = now()
       where id = $5 returning *`,
      [sequence, alt, JSON.stringify({ sequence }), JSON.stringify({ source: input.source, sourceUrl: input.sourceUrl || null }), existing.id]
    );
    return { ...(row || existing), absolutePath };
  }
  const absolutePath = await writeStoredBuffer(storageKey, normalized.bytes);
  const metadata = await sharp(normalized.bytes, { animated: true }).metadata().catch(() => null);
  const id = createId("media");
  const row = await one<AssetMedia>(
    `insert into asset_media
      (id, tenant_id, workspace_id, asset_id, storage_key, mime_type, size_bytes, sha256,
       width, height, sequence, alt_text, anchor, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
     on conflict (asset_id, sha256) do update set
       storage_key = excluded.storage_key, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
       width = excluded.width, height = excluded.height, sequence = least(asset_media.sequence, excluded.sequence),
       alt_text = case when asset_media.alt_text = '' then excluded.alt_text else asset_media.alt_text end,
       anchor = excluded.anchor, metadata = asset_media.metadata || excluded.metadata, updated_at = now()
     returning *`,
    [
      id, asset.tenant_id, asset.workspace_id, asset.id, storageKey, normalized.mimeType,
      normalized.bytes.length, sha256, metadata?.width || null, metadata?.height || null, sequence, alt,
      JSON.stringify({ sequence }),
      JSON.stringify({ source: input.source, sourceUrl: input.sourceUrl || null, normalized: normalized.converted })
    ]
  );
  if (!row) throw new Error("文档图片保存失败");
  return { ...row, absolutePath };
}

async function removeStaleMedia(assetId: string, activeIds: Set<string>) {
  const existing = await query<AssetMedia>(`select * from asset_media where asset_id = $1`, [assetId]);
  const stale = existing.filter((item) => !activeIds.has(item.id));
  if (!stale.length) return;
  await query(`delete from asset_media where id = any($1::text[])`, [stale.map((item) => item.id)]);
  await Promise.all(stale.map((item) => removeStoredFile(item.storage_key).catch(() => undefined)));
}

function decodeDataImage(value: string): ImagePayload | null {
  const match = value.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
  if (!match) return null;
  try {
    return { bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64"), mimeType: match[1].toLowerCase(), extension: extensionForMime(match[1]), source: "embedded" };
  } catch {
    return null;
  }
}

async function downloadImage(sourceUrl: string): Promise<ImagePayload | null> {
  const { response, finalUrl } = await fetchPublicImage(sourceUrl);
  if (!response.ok) throw new Error(`文档图片下载失败 (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxRemoteBytes) throw new Error("文档图片超过 30MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxRemoteBytes) throw new Error("文档图片超过 30MB");
  const mimeType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].toLowerCase();
  return { bytes, mimeType, extension: extensionForMime(mimeType, path.extname(finalUrl.pathname).slice(1)), source: "eopera", sourceUrl: finalUrl.toString() };
}

async function fetchPublicImage(sourceUrl: string) {
  let current = await assertPublicUrl(sourceUrl);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await fetch(current, { signal: AbortSignal.timeout(30_000), redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) throw new Error("文档图片重定向次数过多");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error("文档图片重定向失败");
}

async function normalizeImage(input: ImagePayload) {
  const detected = detectImage(input.bytes, input.mimeType, input.extension);
  if (["image/bmp", "image/tiff", "image/heic", "image/heif"].includes(detected.mimeType)) {
    const bytes = await sharp(input.bytes, { animated: true }).rotate().webp({ quality: 88 }).toBuffer();
    return { bytes, mimeType: "image/webp", extension: "webp", converted: true };
  }
  if (!detected.mimeType.startsWith("image/")) {
    const bytes = await sharp(input.bytes, { animated: true }).rotate().webp({ quality: 88 }).toBuffer();
    return { bytes, mimeType: "image/webp", extension: "webp", converted: true };
  }
  return { bytes: input.bytes, mimeType: detected.mimeType, extension: detected.extension, converted: false };
}

function detectImage(bytes: Buffer, fallbackMime: string, fallbackExtension: string) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return { mimeType: "image/gif", extension: "gif" };
  if (bytes.subarray(0, 2).toString() === "BM") return { mimeType: "image/bmp", extension: "bmp" };
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  if (["49492a00", "4d4d002a"].includes(bytes.subarray(0, 4).toString("hex"))) return { mimeType: "image/tiff", extension: "tiff" };
  if (bytes.subarray(4, 8).toString() === "ftyp") return { mimeType: "image/heic", extension: "heic" };
  return { mimeType: fallbackMime, extension: fallbackExtension || extensionForMime(fallbackMime) };
}

function extensionForMime(mimeType: string, fallback = "png") {
  return ({
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/bmp": "bmp",
    "image/webp": "webp", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif"
  } as Record<string, string>)[mimeType.toLowerCase()] || fallback.toLowerCase().replace(/^\./, "") || "png";
}

function cleanAlt(value: string) {
  return value.replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "文档图片";
}
