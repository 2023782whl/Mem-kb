import { describe, expect, it } from "vitest";
import { toHttpErrorResponse } from "../src/http/errors.js";

describe("HTTP error responses", () => {
  it("preserves rate-limit status and returns a localized retry message", () => {
    const error = Object.assign(new Error("Rate limit exceeded, retry in 17 seconds"), { statusCode: 429 });
    expect(toHttpErrorResponse(error, "local")).toEqual({
      statusCode: 429,
      body: {
        error: "rate_limit_exceeded",
        message: "尝试次数过多，请 17 秒后重试",
        retryAfterSeconds: 17
      },
      log: false
    });
  });

  it("does not expose server errors in production", () => {
    expect(toHttpErrorResponse(new Error("database password leaked"), "production")).toEqual({
      statusCode: 500,
      body: { error: "internal_error", message: "服务异常" },
      log: true
    });
  });
});
