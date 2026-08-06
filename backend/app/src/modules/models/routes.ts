import type { FastifyInstance } from "fastify";
import net from "node:net";
import { z } from "zod";
import { audit, requireAdmin, requireUser } from "../../auth/context.js";
import { env } from "../../config/env.js";
import { one, query, tx } from "../../db/pool.js";
import { encryptSecret } from "../../utils/crypto.js";
import { createId } from "../../utils/id.js";
import { completeModel, streamModel } from "./protocols.js";
import { isVerifiedConfig, modelCatalog, modelFingerprint, resolvedConfig } from "./runtime.js";
import type { ModelConfigRow, ModelProtocol } from "./types.js";

const protocolSchema = z.enum(["openai_chat_completions", "anthropic_messages", "gemini_generate_content"]);
const kindSchema = z.enum(["LLM", "IMAGE"]);
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: kindSchema.default("LLM"),
  apiProtocol: protocolSchema.default("openai_chat_completions"),
  baseUrl: z.url().max(500),
  modelName: z.string().trim().min(1).max(160),
  apiKey: z.string().min(1).max(4_000),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(128).max(200_000).default(8192),
  supportsVision: z.boolean().default(false),
  capabilities: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  extraBody: z.record(z.string(), z.unknown()).default({})
});
const updateSchema = createSchema.partial();

function publicConfig(row: ModelConfigRow) {
  const { api_key_encrypted: _apiKey, ...value } = row;
  return { ...value, hasApiKey: Boolean(row.api_key_encrypted), apiKeyMasked: "••••••••" };
}

function parseJson(text: string) {
  const value = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  return JSON.parse(value.trim()) as unknown;
}

async function findConfig(tenantId: string, id: string) {
  return one<ModelConfigRow>(`select * from model_configs where id = $1 and tenant_id = $2 and deleted_at is null`, [id, tenantId]);
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (env.runtime === "production" && url.protocol !== "https:") throw new Error("生产环境模型地址必须使用 HTTPS");
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("模型地址协议不受支持");
  if (env.runtime === "production" && isPrivateHost(url.hostname)) throw new Error("生产环境模型地址不能指向本机或私有网络");
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return net.isIP(host) === 6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb"));
}

export async function registerModelRoutes(app: FastifyInstance) {
  app.get("/api/models", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    return { models: await modelCatalog(user.tenant_id) };
  });

  app.get("/api/model-configs", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const rows = await query<ModelConfigRow>(`select * from model_configs where tenant_id = $1 and deleted_at is null order by created_at desc`, [user.tenant_id]);
    return { configs: rows.map(publicConfig) };
  });

  app.get("/api/model-configs/protocols", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    return { protocols: [
      { id: "openai_chat_completions", name: "OpenAI Compatible" },
      { id: "anthropic_messages", name: "Anthropic Messages" },
      { id: "gemini_generate_content", name: "Gemini GenerateContent" }
    ] satisfies Array<{ id: ModelProtocol; name: string }> };
  });

  app.post("/api/model-configs", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const body = createSchema.parse(request.body);
    const duplicate = await one<{ id: string }>(
      `select id from model_configs where tenant_id=$1 and name=$2 and deleted_at is null`, [user.tenant_id, body.name]
    );
    if (duplicate) return reply.code(409).send({ error: "model_name_exists", message: "模型名称已存在" });
    const id = createId("model");
    const row = await one<ModelConfigRow>(
      `insert into model_configs
       (id, tenant_id, name, kind, api_protocol, base_url, model_name, api_key_encrypted,
        temperature, max_tokens, supports_vision, capabilities, extra_body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb) returning *`,
      [id, user.tenant_id, body.name, body.kind, body.apiProtocol, normalizeBaseUrl(body.baseUrl), body.modelName,
        encryptSecret(body.apiKey, env.model.secret), body.temperature, body.maxTokens, body.supportsVision,
        JSON.stringify([...new Set(body.capabilities)]), JSON.stringify(body.extraBody)]
    );
    await audit(user, "model.create", "model_config", id, { name: body.name, protocol: body.apiProtocol });
    return reply.code(201).send({ config: publicConfig(row!) });
  });

  app.patch("/api/model-configs/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const current = await findConfig(user.tenant_id, id);
    if (!current) return reply.code(404).send({ error: "model_not_found", message: "模型配置不存在" });
    const body = updateSchema.parse(request.body);
    const next = {
      name: body.name ?? current.name,
      kind: body.kind ?? current.kind,
      apiProtocol: body.apiProtocol ?? current.api_protocol,
      baseUrl: body.baseUrl ? normalizeBaseUrl(body.baseUrl) : current.base_url,
      modelName: body.modelName ?? current.model_name,
      apiKeyEncrypted: body.apiKey ? encryptSecret(body.apiKey, env.model.secret) : current.api_key_encrypted,
      temperature: body.temperature ?? current.temperature,
      maxTokens: body.maxTokens ?? current.max_tokens,
      supportsVision: body.supportsVision ?? current.supports_vision,
      capabilities: body.capabilities ?? current.capabilities,
      extraBody: body.extraBody ?? current.extra_body
    };
    const securityChanged = Boolean(body.apiKey || body.apiProtocol || body.baseUrl || body.modelName || body.kind || body.extraBody);
    const row = await one<ModelConfigRow>(
      `update model_configs set name=$3, kind=$4, api_protocol=$5, base_url=$6, model_name=$7,
       api_key_encrypted=$8, temperature=$9, max_tokens=$10, supports_vision=$11, capabilities=$12::jsonb,
       extra_body=$13::jsonb, config_revision=config_revision+1,
       security_revision=security_revision + $14, key_revision=key_revision + $15,
       verification_status=case when $14 = 1 then 'unverified' else verification_status end,
       verification_error=case when $14 = 1 then null else verification_error end,
       verified_fingerprint=case when $14 = 1 then null else verified_fingerprint end,
       verified_at=case when $14 = 1 then null else verified_at end,
       enabled=case when $14 = 1 then false else enabled end,
       is_default=case when $14 = 1 then false else is_default end, updated_at=now()
       where id=$1 and tenant_id=$2 and deleted_at is null returning *`,
      [id, user.tenant_id, next.name, next.kind, next.apiProtocol, next.baseUrl, next.modelName, next.apiKeyEncrypted,
        next.temperature, next.maxTokens, next.supportsVision, JSON.stringify([...new Set(next.capabilities)]), JSON.stringify(next.extraBody),
        securityChanged ? 1 : 0, body.apiKey ? 1 : 0]
    );
    await audit(user, "model.update", "model_config", id, { securityChanged });
    return { config: publicConfig(row!) };
  });

  app.post("/api/model-configs/:id/test", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await findConfig(user.tenant_id, id);
    if (!row) return reply.code(404).send({ error: "model_not_found", message: "模型配置不存在" });
    await query(`update model_configs set verification_status='verifying', verification_error=null, updated_at=now() where id=$1`, [id]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("verification_timeout")), 60_000);
    try {
      const model = resolvedConfig(row);
      const text = await completeModel(model, [{ role: "user", content: "只回复 MEM_KB_OK" }], { maxTokens: 64, signal: controller.signal });
      let streamed = "";
      await streamModel(model, [{ role: "user", content: "只回复 STREAM_OK" }], (delta) => { streamed += delta; }, { maxTokens: 64, signal: controller.signal });
      const json = await completeModel(model, [{ role: "user", content: '只输出合法 JSON：{"ok":true}' }], { maxTokens: 128, json: true, signal: controller.signal });
      parseJson(json.text);
      const fingerprint = modelFingerprint(row, model.apiKey);
      const verified = await one<ModelConfigRow>(
        `update model_configs set verification_status='verified', verification_error=null,
         verified_fingerprint=$2, verified_at=now(), updated_at=now() where id=$1 returning *`,
        [id, fingerprint]
      );
      await audit(user, "model.verify", "model_config", id, { ok: true });
      return { config: publicConfig(verified!), checks: { text: Boolean(text.text), stream: Boolean(streamed), json: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "模型验证失败";
      const failed = await one<ModelConfigRow>(
        `update model_configs set verification_status='failed', verification_error=$2,
         verified_fingerprint=null, verified_at=null, enabled=false, is_default=false, updated_at=now()
         where id=$1 returning *`, [id, message]
      );
      await audit(user, "model.verify", "model_config", id, { ok: false, error: message });
      return reply.code(422).send({ config: publicConfig(failed!), error: "verification_failed", message });
    } finally {
      clearTimeout(timer);
    }
  });

  app.post("/api/model-configs/:id/enable", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const row = await findConfig(user.tenant_id, id);
    if (!row) return reply.code(404).send({ error: "model_not_found", message: "模型配置不存在" });
    const resolved = resolvedConfig(row);
    if (enabled && !isVerifiedConfig(row, resolved.apiKey)) return reply.code(409).send({ error: "verification_required", message: "请先通过连接验证" });
    const updated = await one<ModelConfigRow>(
      `update model_configs set enabled=$3, is_default=case when $3 then is_default else false end, updated_at=now()
       where id=$1 and tenant_id=$2 returning *`, [id, user.tenant_id, enabled]
    );
    await audit(user, enabled ? "model.enable" : "model.disable", "model_config", id);
    return { config: publicConfig(updated!) };
  });

  app.post("/api/model-configs/:id/default", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await findConfig(user.tenant_id, id);
    if (!row) return reply.code(404).send({ error: "model_not_found", message: "模型配置不存在" });
    const resolved = resolvedConfig(row);
    if (!row.enabled || !isVerifiedConfig(row, resolved.apiKey)) return reply.code(409).send({ error: "verification_required", message: "只有已验证并启用的模型可以设为默认" });
    const updated = await tx(async (client) => {
      await client.query(`update model_configs set is_default=false, updated_at=now() where tenant_id=$1 and kind=$2 and deleted_at is null`, [user.tenant_id, row.kind]);
      const result = await client.query<ModelConfigRow>(`update model_configs set is_default=true, updated_at=now() where id=$1 returning *`, [id]);
      return result.rows[0];
    });
    await audit(user, "model.default", "model_config", id, { kind: row.kind });
    return { config: publicConfig(updated) };
  });

  app.delete("/api/model-configs/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await findConfig(user.tenant_id, id);
    if (!row) return reply.code(404).send({ error: "model_not_found", message: "模型配置不存在" });
    if (row.is_default) return reply.code(409).send({ error: "default_model", message: "请先切换默认模型再删除" });
    await query(`update model_configs set deleted_at=now(), enabled=false, updated_at=now() where id=$1 and tenant_id=$2`, [id, user.tenant_id]);
    await audit(user, "model.delete", "model_config", id, { name: row.name });
    return { ok: true };
  });
}
