import { env } from "../../config/env.js";
import { one, query, runAsSystem } from "../../db/pool.js";
import type { ChannelBinding, User } from "../../db/schema.js";
import { runKnowledgeAnswer } from "../../services/model.js";
import { decryptSecret } from "../../utils/crypto.js";
import { createId } from "../../utils/id.js";
import pino from "pino";
import { failTrace, traceEvent } from "../traces/service.js";
import { persistQaAnswer, prepareQa, type QaRequest } from "../qa/service.js";
import {
  normalizeWechatMessage, sanitizeWechatBaseUrl, splitWechatText, WechatILinkClient,
  type ILinkMessage, type NormalizedWechatMessage
} from "./ilink.js";

const pollers = new Map<string, AbortController>();
const channelLogger = pino({ name: "wechat-channel" });

export function startWechatBinding(bindingId: string) {
  stopWechatBinding(bindingId);
  const controller = new AbortController();
  pollers.set(bindingId, controller);
  void pollBinding(bindingId, controller).finally(() => {
    if (pollers.get(bindingId) === controller) pollers.delete(bindingId);
  });
}

export function stopWechatBinding(bindingId: string) {
  pollers.get(bindingId)?.abort(new Error("channel_stopped"));
  pollers.delete(bindingId);
}

export async function startWechatChannels() {
  const bindings = await runAsSystem(() => query<ChannelBinding>(
    `select * from channel_bindings where channel = 'wechat' and status = 'active' and credentials_enc is not null`
  ));
  bindings.forEach((binding) => startWechatBinding(binding.id));
}

export function stopWechatChannels() {
  for (const id of [...pollers.keys()]) stopWechatBinding(id);
}

async function pollBinding(bindingId: string, controller: AbortController) {
  let failures = 0;
  let backoffMs = 2_000;
  while (!controller.signal.aborted) {
    const binding = await runAsSystem(() => one<ChannelBinding>(
      `select * from channel_bindings where id = $1 and status = 'active'`, [bindingId]
    ));
    if (!binding?.credentials_enc) return;
    const config = binding.config || {};
    const baseUrl = sanitizeWechatBaseUrl(String(config.baseUrl || env.channels.wechatBaseUrl), env.channels.wechatBaseUrl);
    const client = new WechatILinkClient(baseUrl, decryptSecret(binding.credentials_enc, env.authSecret));
    try {
      const payload = await client.updates(String(config.cursor || ""), env.channels.pollTimeoutMs, controller.signal);
      if (controller.signal.aborted) return;
      const messages = Array.isArray(payload.msgs) ? payload.msgs as ILinkMessage[] : [];
      for (const raw of messages) await runAsSystem(() => processInbound(binding, raw, client));
      await runAsSystem(() => query(
        `update channel_bindings
            set connected = true, last_connected_at = now(), updated_at = now(),
                config = jsonb_set(config, '{cursor}', to_jsonb($2::text), true)
          where id = $1 and status = 'active'`,
        [bindingId, String(payload.get_updates_buf || config.cursor || "")]
      ));
      failures = 0;
      backoffMs = 2_000;
    } catch (error) {
      if (controller.signal.aborted) return;
      failures += 1;
      channelLogger.warn({ err: error, bindingId, failures }, "WeChat polling failed");
      await runAsSystem(() => query(
        `update channel_bindings set connected = false, updated_at = now(), config = jsonb_set(config, '{lastError}', to_jsonb($2::text), true) where id = $1`,
        [bindingId, error instanceof Error ? error.message.slice(0, 500) : "poll_failed"]
      ));
      if (failures >= 5 && error instanceof Error && error.message.includes("-14")) {
        await runAsSystem(() => query(`update channel_bindings set status = 'expired', connected = false, updated_at = now() where id = $1`, [bindingId]));
        return;
      }
      await wait(backoffMs, controller.signal);
      backoffMs = Math.min(backoffMs * 2, failures >= 5 ? 60_000 : 16_000);
    }
  }
}

async function processInbound(binding: ChannelBinding, raw: ILinkMessage, client: WechatILinkClient) {
  const message = normalizeWechatMessage(raw, String(binding.config.ilinkBotId || ""));
  if (!message) return;
  const inboundId = createId("channel_message");
  const inserted = await one<{ id: string }>(
    `insert into channel_messages
      (id, tenant_id, binding_id, external_event_id, external_conversation_id, external_user_id, direction, is_group, content, status, metadata)
     values ($1,$2,$3,$4,$5,$6,'inbound',$7,$8,'received',$9)
     on conflict (binding_id, external_event_id) where external_event_id is not null do nothing returning id`,
    [inboundId, binding.tenant_id, binding.id, message.eventId, message.conversationId, message.fromUserId, message.isGroup, message.text, JSON.stringify({ contextToken: message.contextToken })]
  );
  if (!inserted) return;

  const identity = await one<{ user_id: string | null }>(
    `insert into channel_identities (id, tenant_id, binding_id, external_user_id, display_name, is_group)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (binding_id, external_user_id) do update set updated_at = now(), is_group = excluded.is_group
     returning user_id`,
    [createId("channel_identity"), binding.tenant_id, binding.id, message.fromUserId, message.isGroup ? "微信群成员" : "微信用户", message.isGroup]
  );
  const user = await one<User>(
    `select * from users where id = $1 and tenant_id = $2 and status = 'active'`,
    [identity?.user_id || binding.created_by, binding.tenant_id]
  );
  if (!user || !binding.workspace_ids.length) {
    await markInboundFailed(inboundId, "渠道未绑定可用用户或知识库");
    return;
  }

  await query(`update channel_messages set status = 'processing', updated_at = now() where id = $1`, [inboundId]);
  const previous = await one<{ conversation_id: string | null }>(
    `select metadata->>'conversationId' as conversation_id from channel_messages
      where binding_id = $1 and external_conversation_id = $2 and direction = 'inbound' and id <> $3
      order by created_at desc limit 1`,
    [binding.id, message.conversationId, inboundId]
  );
  const qaBody: QaRequest = {
    workspaceId: binding.workspace_ids[0],
    workspaceIds: binding.workspace_ids,
    question: message.text,
    conversationId: previous?.conversation_id || undefined,
    options: { documentQa: true, webSearch: false, imageSearch: false },
    source: "wechat"
  };
  let prepared: Awaited<ReturnType<typeof prepareQa>> | null = null;
  let failurePhase: "model" | "persistence" | "channel" = "model";
  try {
    prepared = await prepareQa(user, qaBody);
    await traceEvent(user, prepared.trace.id, "channel", "completed", message.isGroup ? "接收微信群聊消息" : "接收微信私聊消息", undefined, { bindingId: binding.id });
    const modelStartedAt = Date.now();
    await traceEvent(user, prepared.trace.id, "model", "running", "微信渠道模型调用");
    const answer = await runKnowledgeAnswer(prepared.modelInput);
    await traceEvent(user, prepared.trace.id, "model", "completed", "模型生成完成", Date.now() - modelStartedAt);
    failurePhase = "persistence";
    const assistant = await persistQaAnswer(user, qaBody, prepared, answer);
    await query(
      `update channel_messages set status = 'completed', metadata = metadata || $2::jsonb, updated_at = now() where id = $1`,
      [inboundId, JSON.stringify({ conversationId: prepared.conversation.id, assistantMessageId: assistant.id })]
    );
    failurePhase = "channel";
    const deliveryStartedAt = Date.now();
    await traceEvent(user, prepared.trace.id, "channel", "running", "投递微信回复");
    await deliverReply(binding, message, answer, client);
    await traceEvent(user, prepared.trace.id, "channel", "completed", "微信回复已送达", Date.now() - deliveryStartedAt);
  } catch (error) {
    if (prepared) {
      await traceEvent(user, prepared.trace.id, failurePhase, "failed", error instanceof Error ? error.message : "微信渠道处理失败");
      await failTrace(prepared.trace.id, error, prepared.trace.startedAt, failurePhase);
    }
    channelLogger.error({ err: error, bindingId: binding.id, traceId: prepared?.trace.id, phase: failurePhase }, "WeChat inbound processing failed");
    await markInboundFailed(inboundId, error instanceof Error ? error.message : "微信渠道处理失败");
  }
}

async function deliverReply(binding: ChannelBinding, target: NormalizedWechatMessage, answer: string, client: WechatILinkClient) {
  const outboundId = createId("channel_message");
  const deliveryId = createId("channel_delivery");
  await query(
    `insert into channel_messages
      (id, tenant_id, binding_id, external_conversation_id, external_user_id, direction, is_group, content, status, metadata)
     values ($1,$2,$3,$4,$5,'outbound',$6,$7,'processing','{}')`,
    [outboundId, binding.tenant_id, binding.id, target.conversationId, target.fromUserId, target.isGroup, answer]
  );
  await query(
    `insert into channel_deliveries
      (id, tenant_id, binding_id, message_id, external_conversation_id, status, attempts)
     values ($1,$2,$3,$4,$5,'sending',1)`,
    [deliveryId, binding.tenant_id, binding.id, outboundId, target.conversationId]
  );
  try {
    for (const [index, chunk] of splitWechatText(answer).entries()) {
      await client.sendMessage(target.fromUserId, target.contextToken, chunk, `mem-kb:${deliveryId}:${index}`);
    }
    await query(`update channel_messages set status = 'completed', updated_at = now() where id = $1`, [outboundId]);
    await query(`update channel_deliveries set status = 'delivered', delivered_at = now(), updated_at = now() where id = $1`, [deliveryId]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信投递失败";
    await query(`update channel_messages set status = 'failed', error = $2, updated_at = now() where id = $1`, [outboundId, message]);
    await query(`update channel_deliveries set status = 'failed', last_error = $2, updated_at = now() where id = $1`, [deliveryId, message]);
    throw error;
  }
}

async function markInboundFailed(id: string, error: string) {
  await query(`update channel_messages set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, error.slice(0, 2_000)]);
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
