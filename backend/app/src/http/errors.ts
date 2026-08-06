interface AppError extends Error {
  code?: string;
  issues?: unknown;
  statusCode?: number;
}

export interface HttpErrorResponse {
  statusCode: number;
  body: { error: string; message: string; issues?: unknown; retryAfterSeconds?: number };
  log: boolean;
}

function retryAfterSeconds(message: string) {
  const value = message.match(/retry in (\d+)/i)?.[1];
  return value ? Number(value) : undefined;
}

export function toHttpErrorResponse(error: unknown, runtime: string): HttpErrorResponse {
  const err = error as AppError;
  if (err.name === "PermissionDenied") {
    return { statusCode: 403, body: { error: "permission_denied", message: "没有权限访问该资源" }, log: false };
  }
  if (err.name === "InvalidQaScopeError") {
    return { statusCode: 400, body: { error: "invalid_qa_scope", message: err.message }, log: false };
  }
  if (err.issues) {
    return { statusCode: 400, body: { error: "invalid_request", message: "请求参数不正确", issues: err.issues }, log: false };
  }
  if (err.statusCode === 429) {
    const seconds = retryAfterSeconds(err.message);
    return {
      statusCode: 429,
      body: {
        error: "rate_limit_exceeded",
        message: seconds ? `尝试次数过多，请 ${seconds} 秒后重试` : "尝试次数过多，请稍后重试",
        retryAfterSeconds: seconds
      },
      log: false
    };
  }
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return {
      statusCode: err.statusCode,
      body: { error: err.code?.toLowerCase() || "request_failed", message: runtime === "production" ? "请求失败" : err.message },
      log: false
    };
  }
  return {
    statusCode: 500,
    body: { error: "internal_error", message: runtime === "production" ? "服务异常" : err.message || "服务异常" },
    log: true
  };
}
