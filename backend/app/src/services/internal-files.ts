import crypto from "node:crypto";
import { env } from "../config/env.js";

function signaturePayload(assetId: string, expires: number) {
  return `${assetId}:${expires}`;
}

function sign(assetId: string, expires: number) {
  return crypto.createHmac("sha256", env.authSecret).update(signaturePayload(assetId, expires)).digest("hex");
}

export function createInternalSourceUrl(assetId: string) {
  const expires = Math.floor(Date.now() / 1000) + env.documentProcessor.sourceUrlTtlSeconds;
  const url = new URL(`/internal/assets/${encodeURIComponent(assetId)}/source`, env.publicBaseUrl);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", sign(assetId, expires));
  return url.toString();
}

export function verifyInternalSourceUrl(assetId: string, expiresValue: string, signature: string) {
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(assetId, expires));
  const received = Buffer.from(signature || "");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
