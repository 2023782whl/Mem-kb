import crypto from "node:crypto";

const CHANNEL_VERSION = "1.0.0";
const TEXT_LIMIT = 2_000;

export interface ILinkMessage {
  message_id?: string;
  msg_id?: string;
  client_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  session_id?: string;
  group_id?: string;
  context_token?: string;
  message_type?: number;
  item_list?: Array<{ type?: number; text_item?: { text?: string }; voice_item?: { text?: string } }>;
}

export interface NormalizedWechatMessage {
  eventId: string;
  fromUserId: string;
  toUserId: string;
  conversationId: string;
  contextToken: string;
  text: string;
  isGroup: boolean;
  raw: ILinkMessage;
}

export function validateWechatHost(host: string) {
  const normalized = host.trim().toLowerCase().split(":", 1)[0];
  return normalized === "ilinkai.weixin.qq.com" || normalized.endsWith(".weixin.qq.com");
}

export function sanitizeWechatBaseUrl(value: string, fallback: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && validateWechatHost(url.hostname)) return `https://${url.hostname}`;
  } catch {
    // Fall through to the trusted default.
  }
  return fallback.replace(/\/$/, "");
}

export function normalizeWechatMessage(message: ILinkMessage, botId = ""): NormalizedWechatMessage | null {
  if (!message || message.message_type === 2 || (botId && message.from_user_id === botId)) return null;
  const fromUserId = String(message.from_user_id || "").trim();
  const contextToken = String(message.context_token || "").trim();
  const eventId = String(message.message_id || message.msg_id || message.client_id || "").trim();
  const text = extractWechatText(message);
  if (!fromUserId || !contextToken || !eventId || !text) return null;
  const sessionId = String(message.session_id || "").trim();
  const groupId = String(message.group_id || "").trim();
  const isGroup = Boolean(groupId) || Boolean(sessionId && !sessionId.includes("#") && sessionId !== fromUserId);
  return {
    eventId,
    fromUserId,
    toUserId: String(message.to_user_id || "").trim(),
    conversationId: groupId || sessionId || fromUserId,
    contextToken,
    text,
    isGroup,
    raw: message
  };
}

export function extractWechatText(message: ILinkMessage) {
  const parts = (message.item_list || []).flatMap((item) => {
    if (item.type === 1 && item.text_item?.text) return [item.text_item.text.trim()];
    if (item.type === 3 && item.voice_item?.text) return [item.voice_item.text.trim()];
    return [];
  }).filter(Boolean);
  return parts.join("\n");
}

export function splitWechatText(value: string, limit = TEXT_LIMIT) {
  const result: string[] = [];
  let remaining = value.trim();
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const breaks = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")];
    const index = Math.max(...breaks);
    const cut = index > limit * 0.45 ? index : limit;
    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

export class WechatILinkClient {
  constructor(private readonly baseUrl: string, private readonly token = "") {}

  async createQrCode(localTokens: string[] = []) {
    return this.request("/ilink/bot/get_bot_qrcode?bot_type=3", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local_token_list: localTokens.slice(0, 10) })
    }, false, 20_000);
  }

  async qrStatus(qrcode: string, verifyCode = "") {
    const params = new URLSearchParams({ qrcode });
    if (verifyCode) params.set("verify_code", verifyCode);
    return this.request(`/ilink/bot/get_qrcode_status?${params}`, { headers: { "iLink-App-ClientVersion": "1" } }, false, 40_000);
  }

  async updates(cursor: string, timeoutMs: number, signal?: AbortSignal) {
    return this.request("/ilink/bot/getupdates", {
      method: "POST",
      body: JSON.stringify({ get_updates_buf: cursor, base_info: { channel_version: CHANNEL_VERSION } }),
      signal
    }, true, timeoutMs + 5_000);
  }

  async sendMessage(toUserId: string, contextToken: string, text: string, clientId: string) {
    return this.request("/ilink/bot/sendmessage", {
      method: "POST",
      body: JSON.stringify({
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text } }]
        },
        base_info: { channel_version: CHANNEL_VERSION }
      })
    }, true, 20_000);
  }

  private async request(path: string, init: RequestInit, authenticated: boolean, timeoutMs: number) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(authenticated ? {
          AuthorizationType: "ilink_bot_token",
          Authorization: `Bearer ${this.token}`,
          "X-WECHAT-UIN": randomWechatUin()
        } : {}),
        ...init.headers
      },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.errmsg || `微信 iLink 请求失败：${response.status}`));
    const errcode = Number(payload.errcode || payload.ret || 0);
    if (errcode) throw new Error(`微信 iLink 错误 ${errcode}：${String(payload.errmsg || "")}`);
    return payload;
  }
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value)).toString("base64");
}
