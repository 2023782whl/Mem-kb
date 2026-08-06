import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import {
  assertWorkspaceSlug,
  cancelJob,
  getGovernanceCenter,
  getOperationsCenter,
  getSkillDetail,
  getWorkspaceGraphDetail,
  getWorkspaceIntelligence,
  listWorkspaceSeeds,
  retryJob,
  writeOntology
} from "./service.js";

function requireAdmin(user: { is_admin: boolean }, reply: FastifyReply) {
  if (user.is_admin) return true;
  reply.code(403).send({ error: "permission_denied", message: "仅系统管理员可访问 GBrain 运行与治理能力" });
  return false;
}

const workspaceQuery = z.object({ workspaceId: z.string().min(1) });

export async function registerGBrainRoutes(app: FastifyInstance) {
  app.get("/api/gbrain/seeds", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { workspaceId } = workspaceQuery.parse(request.query);
    await assertWorkspace(user, workspaceId, "read");
    return { seeds: await listWorkspaceSeeds(user.tenant_id, workspaceId) };
  });

  app.get("/api/gbrain/graph", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({
      workspaceId: z.string().min(1),
      slug: z.string().min(1),
      depth: z.coerce.number().int().min(1).max(10).default(3)
    }).parse(request.query);
    await assertWorkspace(user, params.workspaceId, "read");
    await assertWorkspaceSlug(user.tenant_id, params.workspaceId, params.slug);
    return getWorkspaceGraphDetail(params.slug, params.depth);
  });

  app.get("/api/gbrain/intelligence", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({
      workspaceId: z.string().min(1),
      topic: z.string().max(300).optional(),
      slug: z.string().optional(),
      severity: z.enum(["low", "medium", "high"]).optional()
    }).parse(request.query);
    await assertWorkspace(user, params.workspaceId, "read");
    if (params.slug) await assertWorkspaceSlug(user.tenant_id, params.workspaceId, params.slug);
    return getWorkspaceIntelligence({
      tenantId: user.tenant_id,
      workspaceId: params.workspaceId,
      topic: params.topic,
      slug: params.slug,
      severity: params.severity,
      isAdmin: user.is_admin
    });
  });

  app.post("/api/gbrain/ontology", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    const body = z.object({
      workspaceId: z.string().min(1),
      entity: z.string().min(1),
      dimension: z.string().min(1).max(100),
      value: z.string().min(1).max(500),
      confidence: z.number().min(0).max(1).default(0.7),
      source: z.string().max(500).optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      visibility: z.enum(["private", "world"]).default("private")
    }).parse(request.body);
    await assertWorkspace(user, body.workspaceId, "manage");
    await assertWorkspaceSlug(user.tenant_id, body.workspaceId, body.entity);
    const observation = await writeOntology({
      entity: body.entity,
      dimension: body.dimension,
      value: body.value,
      confidence: body.confidence,
      source: body.source || `aiteam:${body.workspaceId}`,
      valid_from: body.validFrom,
      valid_to: body.validTo,
      visibility: body.visibility
    });
    await audit(user, "gbrain.ontology.propose", "gbrain_entity", body.entity, {
      workspaceId: body.workspaceId,
      dimension: body.dimension,
      confidence: body.confidence
    });
    return reply.code(201).send({ observation });
  });

  app.get("/api/gbrain/operations", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    return getOperationsCenter(user.tenant_id);
  });

  app.post("/api/gbrain/jobs/:id/retry", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const job = await retryJob(id);
    await audit(user, "gbrain.job.retry", "gbrain_job", String(id), { result: job });
    return { job };
  });

  app.post("/api/gbrain/jobs/:id/cancel", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const job = await cancelJob(id);
    await audit(user, "gbrain.job.cancel", "gbrain_job", String(id), { result: job });
    return { job };
  });

  app.get("/api/gbrain/governance", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    return getGovernanceCenter();
  });

  app.get("/api/gbrain/skills/:name", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user || !requireAdmin(user, reply)) return;
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    const query = z.object({ sourceId: z.string().optional() }).parse(request.query);
    return { skill: await getSkillDetail(params.name, query.sourceId) };
  });
}
