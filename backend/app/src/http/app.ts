import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { env } from "../config/env.js";
import { registerAssetRoutes } from "../modules/assets/routes.js";
import { registerAnalyticsRoutes } from "../modules/analytics/routes.js";
import { registerChannelRoutes } from "../modules/channels/routes.js";
import { registerAuthRoutes } from "../modules/auth/routes.js";
import { registerImageRoutes } from "../modules/images/routes.js";
import { registerGBrainRoutes } from "../modules/gbrain/routes.js";
import { registerNoteRoutes } from "../modules/notes/routes.js";
import { registerQaRoutes } from "../modules/qa/routes.js";
import { registerSystemRoutes } from "../modules/system/routes.js";
import { registerWebRoutes } from "../modules/web/routes.js";
import { registerWorkspaceRoutes } from "../modules/workspaces/routes.js";
import { registerUserRoutes } from "../modules/users/routes.js";
import { registerTraceRoutes } from "../modules/traces/routes.js";
import { registerEvaluationRoutes } from "../modules/evaluation/routes.js";
import { registerConsolidationRoutes } from "../modules/consolidation/routes.js";
import { registerModelRoutes } from "../modules/models/routes.js";
import { withDbRequestContext } from "../db/pool.js";
import { closeAssetQueue } from "../services/asset-queue.js";
import { closeMaintenanceQueue } from "../services/maintenance-queue.js";
import { loggerOptions } from "../observability/logger.js";
import { httpDuration, httpRequests, metrics, refreshRuntimeMetrics } from "../observability/metrics.js";
import { toHttpErrorResponse } from "./errors.js";

const requestStartedAt = new WeakMap<object, bigint>();

export async function buildApp() {
  const app = Fastify({ logger: loggerOptions() });
  app.setErrorHandler((error, request, reply) => {
    const response = toHttpErrorResponse(error, env.runtime);
    if (response.log) request.log.error({ err: error }, "request failed");
    if (response.body.retryAfterSeconds) reply.header("retry-after", response.body.retryAfterSeconds);
    reply.code(response.statusCode).send(response.body);
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  });
  await app.register(rateLimit, { global: false });
  await app.register(cookie, { secret: env.authSecret });
  const allowedOrigins = new Set([
    env.frontendOrigin,
    "http://127.0.0.1:5177",
    "http://127.0.0.1:5178",
    "http://localhost:5177",
    "http://localhost:5178"
  ]);
  await app.register(cors, {
    origin: [...allowedOrigins],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 300
    }
  });
  app.addHook("onRequest", (_request, _reply, done) => {
    withDbRequestContext(done);
  });
  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    reply.header("x-request-id", request.id);
  });
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: "origin_denied", message: "请求来源不受信任" });
    }
  });

  await registerSystemRoutes(app);
  await registerModelRoutes(app);
  await registerAuthRoutes(app);
  await registerUserRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerAssetRoutes(app);
  await registerQaRoutes(app);
  await registerWebRoutes(app);
  await registerImageRoutes(app);
  await registerGBrainRoutes(app);
  await registerNoteRoutes(app);
  await registerAnalyticsRoutes(app);
  await registerChannelRoutes(app);
  await registerTraceRoutes(app);
  await registerEvaluationRoutes(app);
  await registerConsolidationRoutes(app);
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url || request.url.split("?")[0];
    const status = String(reply.statusCode);
    httpRequests.inc({ method: request.method, route, status });
    const started = requestStartedAt.get(request);
    if (started) httpDuration.observe({ method: request.method, route, status }, Number(process.hrtime.bigint() - started) / 1e9);
  });
  app.get("/metrics", async (_request, reply) => {
    await refreshRuntimeMetrics().catch(() => undefined);
    reply.type(metrics.contentType);
    return metrics.metrics();
  });
  app.addHook("onClose", async () => {
    await Promise.all([closeAssetQueue(), closeMaintenanceQueue()]);
  });

  return app;
}
