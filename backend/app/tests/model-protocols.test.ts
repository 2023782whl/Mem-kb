import { afterEach, describe, expect, it, vi } from "vitest";
import { completeModel } from "../src/modules/models/protocols.js";
import { modelFingerprint } from "../src/modules/models/runtime.js";
import type { ModelConfigRow, ResolvedModel } from "../src/modules/models/types.js";

function model(apiProtocol: ResolvedModel["apiProtocol"]): ResolvedModel {
  return {
    id: "test", key: "test", name: "test", modelName: "model-test", kind: "LLM",
    baseUrl: "https://models.example.com/v1", apiKeyEnv: "", apiKey: "secret",
    maxTokens: 1024, supportsVision: false, capabilities: [], apiProtocol,
    temperature: 0.2, extraBody: {}, source: "tenant"
  };
}

describe("model protocols", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes Anthropic messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "ANTHROPIC_OK" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeModel(model("anthropic_messages"), [
      { role: "system", content: "system" }, { role: "user", content: "hello" }
    ]);

    expect(result.text).toBe("ANTHROPIC_OK");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.system).toBe("system");
    expect(request.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("normalizes Gemini content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "GEMINI_OK" }] } }]
    }), { status: 200 })));

    await expect(completeModel(model("gemini_generate_content"), [{ role: "user", content: "hello" }]))
      .resolves.toMatchObject({ text: "GEMINI_OK" });
  });

  it("omits unsupported temperature for GPT-5 compatible models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const runtime = { ...model("openai_chat_completions"), modelName: "gpt-5.5" };

    await completeModel(runtime, [{ role: "user", content: "hello" }]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).not.toHaveProperty("temperature");
  });

  it("invalidates verification when a security field changes", () => {
    const row = {
      api_protocol: "openai_chat_completions", base_url: "https://models.example.com/v1", model_name: "m",
      kind: "LLM", temperature: 0.2, max_tokens: 1024, supports_vision: false, extra_body: {}
    } as ModelConfigRow;
    expect(modelFingerprint(row, "key")).not.toBe(modelFingerprint({ ...row, base_url: "https://other.example.com/v1" }, "key"));
  });
});
