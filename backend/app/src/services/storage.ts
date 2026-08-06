import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { lookup } from "mime-types";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import { classifyUpload, matchesFileSignature, supportedFormatsDescription } from "./document-formats.js";
import { storageProvider } from "./storage-provider.js";

export interface StoredFile {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  format: string;
}

export function classifyMime(mimeType: string, filename = "") {
  return classifyUpload(mimeType, filename);
}

export function validateStoredSignature(absolutePath: string, format: string) {
  const descriptor = fs.openSync(absolutePath, "r");
  const header = Buffer.alloc(4096);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const bytes = header.subarray(0, bytesRead);
  return matchesFileSignature(bytes, format);
}

export function supportedUploadDescription() {
  return supportedFormatsDescription();
}

export function storagePath(storageKey: string) {
  const safeKey = path.normalize(storageKey).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(env.storageRoot, safeKey);
}

export async function persistStoredFile(storageKey: string, absolutePath = storagePath(storageKey)) {
  await storageProvider.persist(storageKey, absolutePath);
}

export async function ensureStoredFile(storageKey: string) {
  return storageProvider.ensureLocal(storageKey, storagePath(storageKey));
}

export async function removeStoredFile(storageKey: string) {
  await storageProvider.remove(storageKey, storagePath(storageKey));
}

export async function saveMultipartFile(file: MultipartFile, bucket: "originals" | "generated" = "originals"): Promise<StoredFile> {
  const ext = path.extname(file.filename || "");
  const format = ext.replace(/^\./, "").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  const storageKey = `${bucket}/${date}/${createId("file")}${ext}`;
  const absolutePath = storagePath(storageKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  file.file.on("data", (chunk: Buffer) => {
    sizeBytes += chunk.length;
    hash.update(chunk);
  });
  await pipeline(file.file, fs.createWriteStream(absolutePath));
  await persistStoredFile(storageKey, absolutePath);

  return {
    storageKey,
    absolutePath,
    sizeBytes,
    sha256: hash.digest("hex"),
    mimeType: file.mimetype || String(lookup(file.filename) || "application/octet-stream"),
    format
  };
}

export async function writeGeneratedMarkdown(title: string, content: string) {
  const date = new Date().toISOString().slice(0, 10);
  const storageKey = `generated/${date}/${createId("answer")}.md`;
  const absolutePath = storagePath(storageKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  await persistStoredFile(storageKey, absolutePath);
  return {
    storageKey,
    absolutePath,
    sizeBytes: Buffer.byteLength(content),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    mimeType: "text/markdown",
    format: "md",
    title
  };
}

export async function writeProcessedMarkdown(assetId: string, content: string) {
  const date = new Date().toISOString().slice(0, 10);
  const storageKey = `parsed/${date}/${assetId}.md`;
  const absolutePath = storagePath(storageKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  await persistStoredFile(storageKey, absolutePath);
  return { storageKey, absolutePath };
}

export async function writeStoredBuffer(storageKey: string, content: Buffer) {
  const absolutePath = storagePath(storageKey);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  await persistStoredFile(storageKey, absolutePath);
  return absolutePath;
}
