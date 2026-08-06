import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, requireAdmin } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { one, query } from "../../db/pool.js";
import type { ChannelBinding, User } from "../../db/schema.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";
import { createId } from "../../utils/id.js";
import { sanitizeWechatBaseUrl, validateWechatHost, WechatILinkClient } from "./ilink.js";
import { startWechatBinding, stopWechatBinding } from "./service.js";

const workspaceBody = z.object({ workspaceIds: z.array(z.string()).min(1).max(20) });

function publicBinding(binding: ChannelBinding) {
  const { credentials_enc: _credentials, ...safe } = binding;
  return safe;
}

async function ownedBinding(user: User, id: string) {
  return one<ChannelBinding>(`select * from channel_bindings where id = $1 and tenant_id = $2`, [id, user.tenant_id]);
}

async function assertWorkspaceScope(user: User, workspaceIds: string[]) {
  const unique = [...new Set(workspaceIds)];
  await Promise.all(unique.map((id) => assertWorkspace(user, id, "read")));
  return unique;
}

export async function registerChannelRoutes(app: FastifyInstance) {
  app.get("/api/channels", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const bindings = await query<ChannelBinding & { creator_name: string; workspace_names: string[] }>(
      `select b.*, u.name as creator_name,
              coalesce(array(select w.name from workspaces w where w.id = any(b.workspace_ids) order by w.name), '{}') as workspace_names
         from channel_bindings b join users u on u.id = b.created_by
        where b.tenant_id = $1 order by b.created_at desc`,
      [user.tenant_id]
    );
    return { bindings: bindings.map(publicBinding) };
  });

  app.post("/api/channels", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const body = workspaceBody.parse(request.body);
    const workspaceIds = await assertWorkspaceScope(user, body.workspaceIds);
    const binding = await one<ChannelBinding>(
      `insert into channel_bindings (id, tenant_id, created_by, channel, workspace_ids)
       values ($1,$2,$3,'wechat',$4) returning *`,
      [createId("channel"), user.tenant_id, user.id, workspaceIds]
    );
    await audit(user, "channel.create", "channel_binding", binding!.id, { channel: "wechat", workspaceIds });
    return { binding: publicBinding(binding!) };
  });

  app.patch("/api/channels/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!await ownedBinding(user, id)) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    const workspaceIds = await assertWorkspaceScope(user, workspaceBody.parse(request.body).workspaceIds);
    const binding = await one<ChannelBinding>(
      `update channel_bindings set workspace_ids = $3, updated_at = now() where id = $1 and tenant_id = $2 returning *`,
      [id, user.tenant_id, workspaceIds]
    );
    await audit(user, "channel.scope.update", "channel_binding", id, { workspaceIds });
    return { binding: publicBinding(binding!) };
  });

  app.post("/api/channels/:id/wechat/qrcode", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const binding = await ownedBinding(user, id);
    if (!binding) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    const localTokens = binding.credentials_enc ? [decryptSecret(binding.credentials_enc, env.authSecret)] : [];
    try {
      const data = await new WechatILinkClient(env.channels.wechatBaseUrl).createQrCode(localTokens);
      const qrcode = String(data.qrcode || "");
      const content = String(data.qrcode_img_content || data.qrcode_img_url || "");
      if (!qrcode || !content) throw new Error("微信二维码接口返回异常");
      const expiresAt = new Date(Date.now() + env.channels.qrTtlSeconds * 1_000).toISOString();
      await query(
        `update channel_bindings set status = 'pending', connected = false, updated_at = now(),
            config = config || $2::jsonb where id = $1`,
        [id, JSON.stringify({ qrExpiresAt: expiresAt, qrRedirectBaseUrl: null })]
      );
      stopWechatBinding(id);
      return { qrcode, content, expiresAt };
    } catch (error) {
      return reply.code(502).send({ error: "wechat_qrcode_failed", message: error instanceof Error ? error.message : "获取微信二维码失败" });
    }
  });

  app.get("/api/channels/:id/wechat/qrcode-status", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const params = z.object({ qrcode: z.string().min(1), verifyCode: z.string().max(12).optional() }).parse(request.query);
    const binding = await ownedBinding(user, id);
    if (!binding) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    const redirect = String(binding.config.qrRedirectBaseUrl || "");
    const baseUrl = sanitizeWechatBaseUrl(redirect || env.channels.wechatBaseUrl, env.channels.wechatBaseUrl);
    try {
      const data = await new WechatILinkClient(baseUrl).qrStatus(params.qrcode, params.verifyCode || "");
      const status = String(data.status || "wait");
      if (status === "scaned_but_redirect") {
        const host = String(data.redirect_host || "").trim().toLowerCase();
        if (!validateWechatHost(host)) return reply.code(502).send({ error: "untrusted_wechat_host", message: "微信返回的接入域名不受信任" });
        await query(`update channel_bindings set config = config || $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify({ qrRedirectBaseUrl: `https://${host}` })]);
        return { status };
      }
      if (status === "binded_redirect" && binding.credentials_enc) {
        await query(`update channel_bindings set status = 'active', connected = false, updated_at = now() where id = $1`, [id]);
        startWechatBinding(id);
        return { status: "confirmed" };
      }
      if (status !== "confirmed") return { status };
      const token = String(data.bot_token || "");
      const ilinkBotId = String(data.ilink_bot_id || "").trim();
      if (!token || !ilinkBotId) throw new Error("微信扫码确认缺少凭证或机器人标识");
      const safeBaseUrl = sanitizeWechatBaseUrl(String(data.baseurl || baseUrl), env.channels.wechatBaseUrl);
      const updated = await one<ChannelBinding>(
        `update channel_bindings
            set credentials_enc = $2, status = 'active', connected = false, updated_at = now(),
                config = config || $3::jsonb
          where id = $1 returning *`,
        [id, encryptSecret(token, env.authSecret), JSON.stringify({
          ilinkBotId,
          ilinkUserId: String(data.ilink_user_id || ""),
          baseUrl: safeBaseUrl,
          cursor: "",
          qrRedirectBaseUrl: null,
          boundAt: new Date().toISOString(),
          lastError: null
        })]
      );
      startWechatBinding(id);
      await audit(user, "channel.wechat.connected", "channel_binding", id, { ilinkBotId });
      return { status: "confirmed", binding: publicBinding(updated!) };
    } catch (error) {
      const code = error instanceof Error && error.message.includes("duplicate key") ? 409 : 502;
      return reply.code(code).send({ error: "wechat_qrcode_status_failed", message: error instanceof Error ? error.message : "确认微信扫码状态失败" });
    }
  });

  app.post("/api/channels/:id/disconnect", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const binding = await ownedBinding(user, id);
    if (!binding) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    stopWechatBinding(id);
    const updated = await one<ChannelBinding>(
      `update channel_bindings set status = 'disabled', connected = false, credentials_enc = null, updated_at = now(),
          config = config - 'cursor' - 'lastError' where id = $1 returning *`,
      [id]
    );
    await audit(user, "channel.disconnect", "channel_binding", id);
    return { binding: publicBinding(updated!) };
  });

  app.delete("/api/channels/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const binding = await ownedBinding(user, id);
    if (!binding) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    stopWechatBinding(id);
    await query(`delete from channel_bindings where id = $1 and tenant_id = $2`, [id, user.tenant_id]);
    await audit(user, "channel.delete", "channel_binding", id, {
      channel: binding.channel,
      status: binding.status,
      workspaceIds: binding.workspace_ids
    });
    return { ok: true };
  });

  app.get("/api/channels/:id/messages", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!await ownedBinding(user, id)) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    return { messages: await query(`select * from channel_messages where binding_id = $1 order by created_at desc limit 100`, [id]) };
  });

  app.get("/api/channels/:id/deliveries", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!await ownedBinding(user, id)) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    return { deliveries: await query(`select * from channel_deliveries where binding_id = $1 order by created_at desc limit 100`, [id]) };
  });

  app.get("/api/channels/:id/identities", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!await ownedBinding(user, id)) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    return { identities: await query(
      `select i.*, u.name as user_name from channel_identities i left join users u on u.id = i.user_id where i.binding_id = $1 order by i.updated_at desc`, [id]
    ) };
  });

  app.patch("/api/channels/:id/identities/:identityId", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id, identityId } = request.params as { id: string; identityId: string };
    const body = z.object({ userId: z.string().nullable() }).parse(request.body);
    if (!await ownedBinding(user, id)) return reply.code(404).send({ error: "channel_not_found", message: "渠道不存在" });
    if (body.userId && !await one(`select id from users where id = $1 and tenant_id = $2 and status = 'active'`, [body.userId, user.tenant_id])) {
      return reply.code(400).send({ error: "invalid_user", message: "绑定用户不存在或已停用" });
    }
    const identity = await one(
      `update channel_identities set user_id = $3, updated_at = now() where id = $1 and binding_id = $2 returning *`,
      [identityId, id, body.userId]
    );
    if (!identity) return reply.code(404).send({ error: "identity_not_found", message: "渠道身份不存在" });
    return { identity };
  });
}
