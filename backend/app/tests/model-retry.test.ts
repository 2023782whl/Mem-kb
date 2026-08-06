import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { runKnowledgeAnswer } from "../src/services/model.js";

describe("model network retry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries one transient fetch failure", async () => {
    process.env[env.model.selected.apiKeyEnv] = "test-key";
    const networkError = new TypeError("fetch failed", { cause: new Error("socket closed") });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await runKnowledgeAnswer({ question: "test", workspaceName: "test", context: "", citations: [] });

    expect(answer).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
