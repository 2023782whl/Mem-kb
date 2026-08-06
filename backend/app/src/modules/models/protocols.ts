import type { ModelMessage, ModelRequestOptions, ResolvedModel } from "./types.js";
import { resilientFetch } from "../../services/outbound.js";
import { MODEL_GENERATION_TIMEOUT_MS } from "./experience.js";

interface CompletionPayload {
  text: string;
  raw: unknown;
}

function endpoint(baseUrl: string, suffix: string) {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

async function responseError(response: Response) {
  const text = await response.text().catch(() => "");
  return new Error(text.slice(0, 1_000) || `模型请求失败：${response.status}`);
}

function modelScope(model: ResolvedModel) {
  return `model:${new URL(model.baseUrl).origin}:${model.modelName}`;
}

async function fetchModel(model: ResolvedModel, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  return resilientFetch(modelScope(model), url, init, { timeoutMs, maxAttempts: 2, signal });
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => contentText((item as { text?: unknown }).text)).join("");
  return "";
}

function dataImage(value: string) {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } };

function anthropicContent(value: unknown) {
  if (!Array.isArray(value)) return contentText(value);
  const blocks: AnthropicBlock[] = [];
  for (const item of value) {
    const block = item as { type?: string; text?: string; image_url?: { url?: string } };
    if (block.type === "text" && block.text) {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    const url = block.image_url?.url;
    if (!url) continue;
    const embedded = dataImage(url);
    blocks.push({ type: "image", source: embedded
      ? { type: "base64", media_type: embedded.mimeType, data: embedded.data }
      : { type: "url", url } });
  }
  return blocks;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string } };

function geminiParts(value: unknown) {
  if (!Array.isArray(value)) return [{ text: contentText(value) }];
  const parts: GeminiPart[] = [];
  for (const item of value) {
    const block = item as { type?: string; text?: string; image_url?: { url?: string } };
    if (block.type === "text" && block.text) {
      parts.push({ text: block.text });
      continue;
    }
    const url = block.image_url?.url;
    if (!url) continue;
    const embedded = dataImage(url);
    parts.push(embedded
      ? { inlineData: { mimeType: embedded.mimeType, data: embedded.data } }
      : { fileData: { fileUri: url } });
  }
  return parts;
}

function supportsTemperature(modelName: string) {
  return !/^(?:gpt-5|o[134](?:-|$))/i.test(modelName);
}

function temperatureError(value: string) {
  return /temperature[\s\S]*(?:unsupported|does not support|only the default)/i.test(value);
}

export async function completeModel(model: ResolvedModel, messages: ModelMessage[], options: ModelRequestOptions = {}): Promise<CompletionPayload> {
  const maxTokens = options.maxTokens || model.maxTokens;
  const temperature = options.temperature ?? model.temperature;
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (model.apiProtocol === "anthropic_messages") {
    url = endpoint(model.baseUrl, "/messages");
    headers = { "x-api-key": model.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    const system = messages.filter((item) => item.role === "system").map((item) => contentText(item.content)).join("\n\n");
    body = {
      ...model.extraBody,
      model: model.modelName,
      system,
      messages: messages.filter((item) => item.role !== "system").map((item) => ({ role: item.role, content: anthropicContent(item.content) })),
      max_tokens: maxTokens,
      ...(temperature !== 1 ? { temperature } : {})
    };
  } else if (model.apiProtocol === "gemini_generate_content") {
    url = `${endpoint(model.baseUrl, `/models/${encodeURIComponent(model.modelName)}:generateContent`)}?key=${encodeURIComponent(model.apiKey)}`;
    headers = { "content-type": "application/json" };
    const systemInstruction = messages.find((item) => item.role === "system");
    body = {
      ...model.extraBody,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: contentText(systemInstruction.content) }] } } : {}),
      contents: messages.filter((item) => item.role !== "system").map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: geminiParts(item.content) })),
      generationConfig: { maxOutputTokens: maxTokens, temperature, ...(options.json ? { responseMimeType: "application/json" } : {}) }
    };
  } else {
    url = endpoint(model.baseUrl, "/chat/completions");
    headers = { authorization: `Bearer ${model.apiKey}`, "content-type": "application/json" };
    body = {
      ...model.extraBody,
      model: model.modelName,
      messages,
      max_completion_tokens: maxTokens,
      ...(supportsTemperature(model.modelName) && temperature !== 1 ? { temperature } : {}),
      ...(options.json ? { response_format: { type: "json_object" } } : {})
    };
  }
  let response = await fetchModel(model, url, { method: "POST", headers, body: JSON.stringify(body) }, MODEL_GENERATION_TIMEOUT_MS, options.signal);
  if (model.apiProtocol === "openai_chat_completions" && response.status === 400 && "temperature" in body) {
    const detail = await response.text();
    if (!temperatureError(detail)) throw new Error(detail.slice(0, 1_000) || "模型请求参数不受支持");
    delete body.temperature;
    response = await fetchModel(model, url, { method: "POST", headers, body: JSON.stringify(body) }, MODEL_GENERATION_TIMEOUT_MS, options.signal);
  }
  if (!response.ok) throw await responseError(response);
  const raw = await response.json() as Record<string, unknown>;
  const text = model.apiProtocol === "anthropic_messages"
    ? contentText(raw.content)
    : model.apiProtocol === "gemini_generate_content"
      ? contentText((((raw.candidates as Array<{ content?: { parts?: unknown[] } }> | undefined)?.[0]?.content?.parts)))
      : contentText((raw.choices as Array<{ message?: { content?: unknown }; text?: unknown }> | undefined)?.[0]?.message?.content)
        || contentText((raw.choices as Array<{ text?: unknown }> | undefined)?.[0]?.text)
        || contentText(raw.output_text);
  if (!text.trim()) throw new Error("模型返回为空");
  return { text: text.trim(), raw };
}

export async function streamModel(model: ResolvedModel, messages: ModelMessage[], onDelta: (text: string) => void, options: ModelRequestOptions = {}) {
  if (model.apiProtocol !== "openai_chat_completions") {
    const result = await completeModel(model, messages, options);
    onDelta(result.text);
    return result.text;
  }
  const body: Record<string, unknown> = {
    ...model.extraBody,
    model: model.modelName,
    messages,
    max_completion_tokens: options.maxTokens || model.maxTokens,
    ...(supportsTemperature(model.modelName) && (options.temperature ?? model.temperature) !== 1 ? { temperature: options.temperature ?? model.temperature } : {}),
    stream: true
  };
  let response = await fetchModel(model, endpoint(model.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: { authorization: `Bearer ${model.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  }, MODEL_GENERATION_TIMEOUT_MS, options.signal);
  if (response.status === 400 && "temperature" in body) {
    const detail = await response.text();
    if (!temperatureError(detail)) throw new Error(detail.slice(0, 1_000) || "模型流式参数不受支持");
    delete body.temperature;
    response = await fetchModel(model, endpoint(model.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${model.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    }, MODEL_GENERATION_TIMEOUT_MS, options.signal);
  }
  if (!response.ok || !response.body) throw response.ok ? new Error("模型流式响应为空") : await responseError(response);
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const raw = line.trim();
      if (!raw.startsWith("data:") || raw === "data: [DONE]") continue;
      try {
        const payload = JSON.parse(raw.slice(5).trim()) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = payload.choices?.[0]?.delta?.content || "";
        if (delta) { answer += delta; onDelta(delta); }
      } catch { /* Provider keep-alive frame. */ }
    }
  }
  if (!answer.trim()) throw new Error("模型流式返回为空");
  return answer;
}
