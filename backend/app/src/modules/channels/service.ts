import { env } from "../../config/env.js";
import { one, query, runAsSystem } from "../../db/pool.js";
import type { Asset, ChannelBinding, User } from "../../db/schema.js";
import { runKnowledgeAnswer } from "../../services/model.js";
import { ensureStoredFile } from "../../services/storage.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";
import { createId } from "../../utils/id.js";
import { Bulkhead } from "../../utils/resilience.js";
import pino from "pino";
import { failTrace, traceEvent } from "../traces/service.js";
import { persistQaAnswer, prepareQa, type QaRequest } from "../qa/service.js";
import { resolveChannelQaOptions } from "./intent.js";
import { decryptChannelCredential } from "./credentials.js";
import {
  normalizeWechatMessage, sanitizeWechatBaseUrl, splitWechatText, WechatILinkClient,
  type ILinkMessage, type NormalizedWechatMessage
} from "./ilink.js";

const pollers = new Map<string, AbortController>();
const recoveringBindings = new Set<string>();
const channelLogger = pino({ name: "wechat-channel" });
const channelWorkerId = createId("channel_worker");
const inboundCapacity = new Bulkhead(env.channels.processingConcurrency, env.channels.processingQueueLimit);
const MAX_ATTEMPTS = 3;

interface StoredInbound {
  id: string;
  attempts: number;
  external_conversation_id: string;
  external_user_id: string;
  is_group: boolean;
  content: string;
  metadata: Record<string, unknown>;
}

function startWechatBinding(bindingId: string) {
  if (pollers.has(bindingId)) return;
  const controller = new AbortController();
  pollers.set(bindingId, controller);
  void pollBinding(bindingId, controller).finally(() => {
    if (pollers.get(bindingId) === controller) pollers.delete(bindingId);
  });
}

function stopWechatBinding(bindingId: string) {
  pollers.get(bindingId)?.abort(new Error("channel_stopped"));
  pollers.delete(bindingId);
}

export async function startWechatChannels() {
  await runAsSystem(async () => {
    await query(
      `update qa_traces set status='failed', error='渠道进程中断', completed_at=now(), updated_at=now()
       where source='wechat' and status='running' and updated_at < now() - interval '2 minutes'`
    );
    await query(
      `update channel_deliveries set status='failed', last_error='渠道进程中断，消息已由租约任务重投', updated_at=now()
       where status='sending' and updated_at < now() - ($1 * interval '1 second')`, [env.channels.processingLeaseSeconds]
    );
    await query(
      `update channel_messages set status='failed', error='渠道进程中断，消息已由租约任务重投', updated_at=now()
       where direction='outbound' and status='processing' and updated_at < now() - ($1 * interval '1 second')`, [env.channels.processingLeaseSeconds]
    );
  });
  await syncWechatChannels();
}

export async function syncWechatChannels() {
  const bindings = await runAsSystem(() => query<ChannelBinding>(
    `with claimable as (
       select id from channel_bindings
        where channel = 'wechat' and status = 'active' and credentials_enc is not null
          and (lease_owner = $1 or lease_expires_at is null or lease_expires_at < now())
        order by case when lease_owner = $1 then 0 else 1 end, updated_at
        for update skip locked
        limit $3
     )
     update channel_bindings binding
        set lease_owner = $1,
            lease_expires_at = now() + ($2 * interval '1 second'),
            updated_at = now()
       from claimable
      where binding.id = claimable.id
      returning binding.*`,
    [channelWorkerId, env.channels.bindingLeaseSeconds, env.channels.maxBindingsPerWorker]
  ));
  const claimed = new Set(bindings.map((binding) => binding.id));
  for (const id of pollers.keys()) {
    if (!claimed.has(id)) stopWechatBinding(id);
  }
  for (const binding of bindings) {
    startWechatBinding(binding.id);
    if (recoveringBindings.has(binding.id)) continue;
    recoveringBindings.add(binding.id);
    void recoverBinding(binding).catch((error) => {
      channelLogger.error({ err: error, bindingId: binding.id }, "WeChat recovery failed");
    }).finally(() => recoveringBindings.delete(binding.id));
  }
}

export async function stopWechatChannels() {
  for (const id of [...pollers.keys()]) stopWechatBinding(id);
  await runAsSystem(() => query(
    `update channel_bindings set lease_owner = null, lease_expires_at = null, connected = false, updated_at = now()
      where lease_owner = $1`,
    [channelWorkerId]
  ));
}

async function pollBinding(bindingId: string, controller: AbortController) {
  let failures = 0;
  let backoffMs = 2_000;
  while (!controller.signal.aborted) {
    const binding = await runAsSystem(() => one<ChannelBinding>(
      `select * from channel_bindings
        where id = $1 and status = 'active' and lease_owner = $2 and lease_expires_at > now()`,
      [bindingId, channelWorkerId]
    ));
    if (!binding?.credentials_enc) return;
    const config = binding.config || {};
    const baseUrl = sanitizeWechatBaseUrl(String(config.baseUrl || env.channels.wechatBaseUrl), env.channels.wechatBaseUrl);
    const client = new WechatILinkClient(baseUrl, decryptChannelCredential(binding.credentials_enc));
    try {
      const payload = await client.updates(String(config.cursor || ""), env.channels.pollTimeoutMs, controller.signal);
      if (controller.signal.aborted) return;
      const messages = Array.isArray(payload.msgs) ? payload.msgs as ILinkMessage[] : [];
      for (const raw of messages) await runAsSystem(() => processInbound(binding, raw, client));
      await runAsSystem(() => query(
        `update channel_bindings
            set connected = true, last_connected_at = now(), updated_at = now(),
                config = jsonb_set(config, '{cursor}', to_jsonb($2::text), true)
          where id = $1 and status = 'active' and lease_owner = $3`,
        [bindingId, String(payload.get_updates_buf || config.cursor || ""), channelWorkerId]
      ));
      failures = 0;
      backoffMs = 2_000;
    } catch (error) {
      if (controller.signal.aborted) return;
      failures += 1;
      channelLogger.warn({ err: error, bindingId, failures }, "WeChat polling failed");
      await runAsSystem(() => query(
        `update channel_bindings set connected = false, updated_at = now(), config = jsonb_set(config, '{lastError}', to_jsonb($2::text), true)
          where id = $1 and lease_owner = $3`,
        [bindingId, error instanceof Error ? error.message.slice(0, 500) : "poll_failed", channelWorkerId]
      ));
      if (failures >= 5 && error instanceof Error && error.message.includes("-14")) {
        await runAsSystem(() => query(
          `update channel_bindings set status = 'expired', connected = false,
             lease_owner = null, lease_expires_at = null, updated_at = now()
            where id = $1 and lease_owner = $2`,
          [bindingId, channelWorkerId]
        ));
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
    [inboundId, binding.tenant_id, binding.id, message.eventId, message.conversationId, message.fromUserId, message.isGroup, message.text, JSON.stringify({
      contextTokenEnc: encryptSecret(message.contextToken, env.channels.secret),
      toUserId: message.toUserId
    })]
  );
  if (!inserted) return;
  queueMicrotask(() => {
    void runAsSystem(() => inboundCapacity.run(() => processStoredInbound(binding, inserted.id, client))).catch((error) => {
      channelLogger.error({ err: error, bindingId: binding.id, inboundId: inserted.id }, "WeChat queued message failed");
    });
  });
}

async function recoverBinding(binding: ChannelBinding) {
  if (!binding.credentials_enc) return;
  const config = binding.config || {};
  const client = new WechatILinkClient(
    sanitizeWechatBaseUrl(String(config.baseUrl || env.channels.wechatBaseUrl), env.channels.wechatBaseUrl),
    decryptChannelCredential(binding.credentials_enc)
  );
  const pending = await runAsSystem(() => query<{ id: string }>(
    `select id from channel_messages
     where binding_id = $1 and direction = 'inbound' and attempts < $2
       and (status = 'received'
         or (status = 'processing' and (processing_started_at is null or processing_started_at < now() - ($3 * interval '1 second')))
         or (status = 'failed' and attempts = 0 and created_at > now() - interval '24 hours'))
     order by created_at limit 20`,
    [binding.id, MAX_ATTEMPTS, env.channels.processingLeaseSeconds]
  ));
  for (const item of pending) {
    await runAsSystem(() => inboundCapacity.run(() => processStoredInbound(binding, item.id, client)));
  }
}

async function processStoredInbound(binding: ChannelBinding, inboundId: string, client: WechatILinkClient) {
  const stored = await one<StoredInbound>(
    `update channel_messages set status='processing', attempts=attempts+1, processing_started_at=now(), error=null, updated_at=now()
     where id=$1 and binding_id=$2 and direction='inbound' and attempts < $3
       and (status='received'
         or (status='processing' and (processing_started_at is null or processing_started_at < now() - ($4 * interval '1 second')))
         or (status='failed' and attempts=0 and created_at > now() - interval '24 hours'))
     returning id, attempts, external_conversation_id, external_user_id, is_group, content, metadata`,
    [inboundId, binding.id, MAX_ATTEMPTS, env.channels.processingLeaseSeconds]
  );
  if (!stored) return;
  const metadata = stored.metadata || {};
  const encryptedToken = String(metadata.contextTokenEnc || "");
  const legacyToken = String(metadata.contextToken || "");
  if (!encryptedToken && !legacyToken) {
    await markInboundFailed(inboundId, "微信上下文凭证缺失");
    return;
  }
  const target: NormalizedWechatMessage = {
    eventId: inboundId,
    fromUserId: stored.external_user_id,
    toUserId: String(metadata.toUserId || ""),
    conversationId: stored.external_conversation_id,
    contextToken: encryptedToken ? decryptSecret(encryptedToken, env.channels.secret) : legacyToken,
    text: stored.content,
    isGroup: stored.is_group,
    raw: {}
  };

  if (typeof metadata.answer === "string") {
    try {
      await deliverReply(binding, target, metadata.answer, client, inboundId, Array.isArray(metadata.imageAssetIds) ? metadata.imageAssetIds.map(String) : []);
      await markInboundCompleted(inboundId);
    } catch (error) {
      await retryOrFailInbound(stored, error);
    }
    return;
  }
  if (metadata.traceId) {
    await query(
      `update qa_traces set status='failed', error='渠道进程中断，已自动恢复', completed_at=now(), updated_at=now()
       where id=$1 and status='running'`, [String(metadata.traceId)]
    );
    await query(
      `update qa_trace_events set status='failed', detail='渠道进程中断' where trace_id=$1 and status='running'`,
      [String(metadata.traceId)]
    );
  }

  const identity = await one<{ user_id: string | null }>(
    `insert into channel_identities (id, tenant_id, binding_id, external_user_id, display_name, is_group)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (binding_id, external_user_id) do update set updated_at = now(), is_group = excluded.is_group
     returning user_id`,
    [createId("channel_identity"), binding.tenant_id, binding.id, target.fromUserId, target.isGroup ? "微信群成员" : "微信用户", target.isGroup]
  );
  const user = await one<User>(
    `select * from users where id = $1 and tenant_id = $2 and status = 'active'`,
    [identity?.user_id || binding.created_by, binding.tenant_id]
  );
  if (!user || !binding.workspace_ids.length) {
    await markInboundFailed(inboundId, "渠道未绑定可用用户或知识库");
    return;
  }

  const previous = await one<{ conversation_id: string | null }>(
    `select metadata->>'conversationId' as conversation_id from channel_messages
      where binding_id = $1 and external_conversation_id = $2 and direction = 'inbound' and id <> $3
      order by created_at desc limit 1`,
    [binding.id, target.conversationId, inboundId]
  );
  const qaBody: QaRequest = {
    workspaceId: binding.workspace_ids[0],
    workspaceIds: binding.workspace_ids,
    question: target.text,
    conversationId: previous?.conversation_id || undefined,
    options: resolveChannelQaOptions(target.text),
    source: "wechat"
  };
  let prepared: Awaited<ReturnType<typeof prepareQa>> | null = null;
  let failurePhase: "model" | "persistence" | "channel" = "model";
  try {
    prepared = await prepareQa(user, qaBody);
    await query(
      `update channel_messages set metadata=metadata || $2::jsonb, updated_at=now() where id=$1`,
      [inboundId, JSON.stringify({ traceId: prepared.trace.id, conversationId: prepared.conversation.id })]
    );
    await traceEvent(user, prepared.trace.id, "channel", "completed", target.isGroup ? "接收微信群聊消息" : "接收微信私聊消息", undefined, { bindingId: binding.id });
    const modelStartedAt = Date.now();
    await traceEvent(user, prepared.trace.id, "model", "running", "微信渠道模型调用");
    const answer = await runKnowledgeAnswer(prepared.modelInput, AbortSignal.timeout(55_000));
    await traceEvent(user, prepared.trace.id, "model", "completed", "模型生成完成", Date.now() - modelStartedAt);
    failurePhase = "persistence";
    const assistant = await persistQaAnswer(user, qaBody, prepared, answer);
    const imageAssetIds = prepared.citations.filter((item) => item.kind === "image" && item.assetId).map((item) => item.assetId!);
    await query(`update channel_messages set metadata=metadata || $2::jsonb, updated_at=now() where id=$1`, [inboundId, JSON.stringify({
      conversationId: prepared.conversation.id,
      assistantMessageId: assistant.id,
      answer,
      imageAssetIds
    })]);
    failurePhase = "channel";
    const deliveryStartedAt = Date.now();
    await traceEvent(user, prepared.trace.id, "channel", "running", "投递微信回复");
    await deliverReply(binding, target, answer, client, inboundId, imageAssetIds);
    await markInboundCompleted(inboundId);
    await traceEvent(user, prepared.trace.id, "channel", "completed", "微信回复已送达", Date.now() - deliveryStartedAt);
  } catch (error) {
    if (prepared) {
      await traceEvent(user, prepared.trace.id, failurePhase, "failed", error instanceof Error ? error.message : "微信渠道处理失败");
      await failTrace(prepared.trace.id, error, prepared.trace.startedAt, failurePhase);
    }
    channelLogger.error({ err: error, bindingId: binding.id, traceId: prepared?.trace.id, phase: failurePhase }, "WeChat inbound processing failed");
    await retryOrFailInbound(stored, error);
  }
}

async function deliverReply(binding: ChannelBinding, target: NormalizedWechatMessage, answer: string, client: WechatILinkClient, stableKey: string, imageAssetIds: string[] = []) {
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
      await client.sendMessage(target.fromUserId, target.contextToken, chunk, `mem-kb:${stableKey}:text:${index}`);
    }
    const images = imageAssetIds.length ? await query<Asset>(
      `select * from assets where tenant_id=$1 and id=any($2::text[]) and type='image' and status='ready' and deleted_at is null limit 3`,
      [binding.tenant_id, [...new Set(imageAssetIds)]]
    ) : [];
    for (const [index, image] of images.entries()) {
      const filePath = await ensureStoredFile(image.thumbnail_storage_key || image.storage_key);
      await client.sendImage(target.fromUserId, target.contextToken, filePath, `mem-kb:${stableKey}:image:${index}`);
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
  await query(
    `update channel_messages set status='failed', processing_started_at=null, error=$2, updated_at=now() where id=$1`,
    [id, error.slice(0, 2_000)]
  );
}

async function markInboundCompleted(id: string) {
  await query(
    `update channel_messages set status='completed', processing_started_at=null,
     metadata=metadata - 'contextTokenEnc' - 'contextToken' - 'answer', updated_at=now() where id=$1`, [id]
  );
}

async function retryOrFailInbound(stored: Pick<StoredInbound, "id" | "attempts">, error: unknown) {
  const message = error instanceof Error ? error.message : "微信渠道处理失败";
  if (stored.attempts < MAX_ATTEMPTS) {
    await query(
      `update channel_messages set status='received', processing_started_at=null, error=$2, updated_at=now() where id=$1`,
      [stored.id, message.slice(0, 2_000)]
    );
    return;
  }
  await markInboundFailed(stored.id, message);
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
