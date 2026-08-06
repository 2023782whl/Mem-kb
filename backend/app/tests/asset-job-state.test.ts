import { describe, expect, it } from "vitest";
import { assetFailureState, normalizeAssetAttempt } from "../src/services/asset-job-state.js";

describe("asset job state", () => {
  it("returns work to the queue while BullMQ has attempts left", () => {
    const attempt = normalizeAssetAttempt({ attempt: 1, maxAttempts: 3, processingId: "job-1" });
    expect(assetFailureState(attempt)).toEqual({ retrying: true, assetStatus: "queued", jobStatus: "queued" });
  });

  it("moves the final failure to a terminal state", () => {
    const attempt = normalizeAssetAttempt({ attempt: 3, maxAttempts: 3 });
    expect(assetFailureState(attempt)).toEqual({ retrying: false, assetStatus: "failed", jobStatus: "failed" });
  });
});
