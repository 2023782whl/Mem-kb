import { load } from "cheerio";
import TurndownService from "turndown";
import { assertPublicUrl } from "../services/public-url.js";

export interface WebReference {
  title: string;
  url: string;
  snippet: string;
  markdown?: string;
}

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
const MAX_BYTES = 3 * 1024 * 1024;

async function limitedText(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new Error("网页内容超过 3MB 限制");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("网页内容超过 3MB 限制");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function safeFetch(rawUrl: string) {
  let current = await assertPublicUrl(rawUrl);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "Mem-kb Knowledge Center/1.0", accept: "text/html,text/plain;q=0.9" },
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) throw new Error("网页重定向次数过多");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`网页请求失败：${response.status}`);
    return { response, finalUrl: current.toString() };
  }
  throw new Error("网页重定向失败");
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function fetchWebPage(rawUrl: string): Promise<WebReference> {
  const { response, finalUrl } = await safeFetch(rawUrl);
  const contentType = response.headers.get("content-type") || "";
  const raw = await limitedText(response);
  if (!contentType.includes("html")) {
    const text = clean(raw);
    return { title: new URL(finalUrl).hostname, url: finalUrl, snippet: text.slice(0, 240), markdown: text };
  }
  const $ = load(raw);
  $("script,style,noscript,svg,nav,footer,header,form,aside").remove();
  const title = clean($("meta[property='og:title']").attr("content") || $("title").text() || new URL(finalUrl).hostname);
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const markdown = turndown.turndown(root.html() || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 100_000);
  return { title, url: finalUrl, snippet: clean(root.text()).slice(0, 280), markdown };
}

function resultUrl(href: string) {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.toString();
  } catch {
    return href;
  }
}

export async function searchWeb(query: string, limit = 5): Promise<WebReference[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 Mem-kb Knowledge Center" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`联网搜索失败：${response.status}`);
  const $ = load(await response.text());
  return $(".result")
    .toArray()
    .map((element) => {
      const link = $(element).find(".result__a").first();
      return {
        title: clean(link.text()),
        url: resultUrl(link.attr("href") || ""),
        snippet: clean($(element).find(".result__snippet").text())
      };
    })
    .filter((item) => item.title && /^https?:\/\//.test(item.url))
    .slice(0, Math.min(limit, 8));
}

export function extractUrls(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s<>()\]\["']+/g) || [])].slice(0, 3);
}
