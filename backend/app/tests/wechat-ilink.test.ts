import { describe, expect, it } from "vitest";
import {
  normalizeWechatMessage, sanitizeWechatBaseUrl, splitWechatText, validateWechatHost
} from "../src/modules/channels/ilink.js";
import { resolveChannelQaOptions } from "../src/modules/channels/intent.js";

describe("WeChat iLink adapter", () => {
  it("accepts only trusted HTTPS WeChat hosts", () => {
    expect(validateWechatHost("ilinkai.weixin.qq.com")).toBe(true);
    expect(validateWechatHost("liteapp.weixin.qq.com")).toBe(true);
    expect(validateWechatHost("weixin.qq.com.evil.test")).toBe(false);
    expect(sanitizeWechatBaseUrl("http://ilinkai.weixin.qq.com", "https://ilinkai.weixin.qq.com"))
      .toBe("https://ilinkai.weixin.qq.com");
  });

  it("normalizes private and group text without accepting bot echoes", () => {
    const direct = normalizeWechatMessage({
      message_id: "m1", from_user_id: "u1", context_token: "ctx",
      item_list: [{ type: 1, text_item: { text: "  查询 SOP  " } }]
    });
    const group = normalizeWechatMessage({
      message_id: "m2", from_user_id: "u2", group_id: "g1", context_token: "ctx2",
      item_list: [{ type: 3, voice_item: { text: "语音问题" } }]
    });

    expect(direct).toMatchObject({ conversationId: "u1", text: "查询 SOP", isGroup: false });
    expect(group).toMatchObject({ conversationId: "g1", text: "语音问题", isGroup: true });
    expect(normalizeWechatMessage({ message_id: "m3", from_user_id: "bot" }, "bot")).toBeNull();
  });

  it("splits long replies without losing content order", () => {
    const source = `${"第一段内容。".repeat(30)}\n\n${"第二段内容。".repeat(30)}`;
    const parts = splitWechatText(source, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 120)).toBe(true);
    expect(parts.join("").replace(/\s/g, "")).toBe(source.replace(/\s/g, ""));
  });

  it("enables image recall only for image intent", () => {
    expect(resolveChannelQaOptions("给我一张知识问答的图片")).toMatchObject({ documentQa: true, imageSearch: true, webSearch: false });
    expect(resolveChannelQaOptions("解释运营 SOP")).toMatchObject({ imageSearch: false, webSearch: false });
    expect(resolveChannelQaOptions("联网查看最新消息")).toMatchObject({ imageSearch: false, webSearch: true });
  });
});
