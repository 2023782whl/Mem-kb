import { describe, expect, it } from "vitest";
import { MODEL_GENERATION_TIMEOUT_MS, modelFailureMessage } from "../src/modules/models/experience.js";

describe("model experience", () => {
  it("uses a long-running generation window by default", () => {
    expect(MODEL_GENERATION_TIMEOUT_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("does not expose runtime timeout messages to users", () => {
    const message = modelFailureMessage(new Error("The operation was aborted due to timeout"));
    expect(message).toContain("15 分钟");
    expect(message).not.toContain("aborted");
  });
});
