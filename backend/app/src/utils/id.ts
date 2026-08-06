import crypto from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function slugSegment(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

export function nowIso() {
  return new Date().toISOString();
}
