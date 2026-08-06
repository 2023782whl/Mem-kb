import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertTenantWrite, assertWorkspace, listWorkspacesForUser } from "../../auth/permissions.js";
import { one, query } from "../../db/pool.js";
import type { BusinessUnit, Workspace } from "../../db/schema.js";
import { createId } from "../../utils/id.js";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().default(""),
  scope: z.enum(["personal", "team"]).default("team"),
  kind: z.enum(["document", "image", "mixed"]).default("document"),
  businessUnitId: z.string().nullable().optional()
});

const workspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get("/api/business-units", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const units = await query<BusinessUnit>(
      `select bu.* from business_units bu
       left join business_unit_members bum on bum.business_unit_id = bu.id and bum.user_id = $1
       where bu.tenant_id = $2 and ($3::boolean = true or bum.user_id is not null or $4::text in ('editor','viewer'))
       order by bu.name`,
      [user.id, user.tenant_id, user.is_admin, user.role]
    );
    return { businessUnits: units };
  });

  app.get("/api/workspaces", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { status } = z.object({ status: z.enum(["active", "archived", "all"]).optional().default("active") }).parse(request.query);
    return { workspaces: await listWorkspacesForUser(user, status) };
  });

  app.post("/api/workspaces", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    assertTenantWrite(user);
    const body = createWorkspaceSchema.parse(request.body);
    if (body.scope === "team" && body.businessUnitId) {
      const unit = await one<{ id: string }>(
        `select bu.id from business_units bu
         left join business_unit_members bum on bum.business_unit_id = bu.id and bum.user_id = $1
         where bu.id = $2 and bu.tenant_id = $3
           and ($4::boolean = true or bum.user_id is not null or $5::text = 'editor')`,
        [user.id, body.businessUnitId, user.tenant_id, user.is_admin, user.role]
      );
      if (!unit) return reply.code(400).send({ error: "invalid_business_unit", message: "业务分区不存在或不可访问" });
    }
    const workspaceId = createId("workspace");
    const workspace = await one<Workspace>(
      `insert into workspaces
       (id, tenant_id, owner_id, name, description, scope, kind, gbrain_source_id, business_unit_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        workspaceId,
        user.tenant_id,
        user.id,
        body.name,
        body.description,
        body.scope,
        body.kind,
        `tenant/${user.tenant_id}/workspace/${workspaceId}`,
        body.scope === "personal" ? null : body.businessUnitId || null
      ]
    );
    await query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
      workspaceId,
      user.id
    ]);
    await audit(user, "workspace.create", "workspace", workspaceId, { name: body.name, scope: body.scope });
    return { workspace: { ...workspace, member_role: "owner", asset_count: 0 } };
  });

  app.patch("/api/workspaces/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = request.params as { id: string };
    await assertWorkspace(user, params.id, "manage");
    const body = z.object({ name: z.string().min(1).max(80), description: z.string().max(500).optional() }).parse(request.body);
    const workspace = await one<Workspace>(
      `update workspaces set name = $1, description = coalesce($2, description), updated_at = now()
       where id = $3 and tenant_id = $4 returning *`,
      [body.name, body.description, params.id, user.tenant_id]
    );
    await audit(user, "workspace.update", "workspace", params.id, body);
    return { workspace };
  });

  app.post("/api/workspaces/:id/archive", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "manage");
    const workspace = await one<Workspace>(`update workspaces set status = 'archived', updated_at = now() where id = $1 and tenant_id = $2 returning *`, [id, user.tenant_id]);
    await audit(user, "workspace.archive", "workspace", id);
    return { workspace };
  });

  app.post("/api/workspaces/:id/restore", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "manage", true);
    const workspace = await one<Workspace>(`update workspaces set status = 'active', updated_at = now() where id = $1 and tenant_id = $2 returning *`, [id, user.tenant_id]);
    await audit(user, "workspace.restore", "workspace", id);
    return { workspace };
  });

  app.delete("/api/workspaces/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const workspace = await assertWorkspace(user, id, "manage", true);
    if (workspace.status !== "archived") return reply.code(409).send({ error: "workspace_not_archived", message: "请先归档 Workspace" });
    const usage = await one<{ assets: number; notes: number }>(
      `select (select count(*)::int from assets where workspace_id = $1) as assets,
              (select count(*)::int from notes where workspace_id = $1) as notes`,
      [id]
    );
    if ((usage?.assets || 0) > 0 || (usage?.notes || 0) > 0) {
      return reply.code(409).send({ error: "workspace_not_empty", message: "Workspace 内仍有资产或笔记，请先清理后再永久删除" });
    }
    await query(`delete from workspaces where id = $1 and tenant_id = $2`, [id, user.tenant_id]);
    await audit(user, "workspace.delete", "workspace", id, { name: workspace.name });
    return { ok: true };
  });

  app.get("/api/workspaces/:id/members", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "manage", true);
    const members = await query<{ user_id: string; email: string; name: string; role: "owner" | "editor" | "viewer"; created_at: string }>(
      `select wm.user_id, u.email, u.name, wm.role, wm.created_at
       from workspace_members wm join users u on u.id = wm.user_id
       where wm.workspace_id = $1 and u.tenant_id = $2 order by case wm.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.name`,
      [id, user.tenant_id]
    );
    return { members };
  });

  app.post("/api/workspaces/:id/members", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const workspace = await assertWorkspace(user, id, "manage", true);
    if (workspace.scope === "personal") return reply.code(400).send({ error: "personal_workspace", message: "个人 Workspace 不支持添加成员" });
    const body = z.object({ email: z.string().email(), role: workspaceRoleSchema.default("viewer") }).parse(request.body);
    const memberUser = await one<{ id: string; email: string; name: string }>(`select id, email, name from users where tenant_id = $1 and lower(email) = lower($2) and status = 'active'`, [user.tenant_id, body.email]);
    if (!memberUser) return reply.code(404).send({ error: "user_not_found", message: "当前租户中没有该用户" });
    const member = await one<{ user_id: string; role: "owner" | "editor" | "viewer"; created_at: string }>(
      `insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)
       on conflict (workspace_id, user_id) do update set role = excluded.role returning user_id, role, created_at`,
      [id, memberUser.id, body.role]
    );
    await audit(user, "workspace.member.add", "workspace", id, { memberUserId: memberUser.id, role: body.role });
    return { member: { ...member, email: memberUser.email, name: memberUser.name } };
  });

  app.patch("/api/workspaces/:id/members/:userId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, userId } = request.params as { id: string; userId: string };
    await assertWorkspace(user, id, "manage", true);
    const { role } = z.object({ role: workspaceRoleSchema }).parse(request.body);
    const current = await one<{ role: "owner" | "editor" | "viewer" }>(`select role from workspace_members where workspace_id = $1 and user_id = $2`, [id, userId]);
    if (!current) return reply.code(404).send({ error: "member_not_found", message: "成员不存在" });
    if (current.role === "owner" && role !== "owner") {
      const owners = await one<{ count: number }>(`select count(*)::int as count from workspace_members where workspace_id = $1 and role = 'owner'`, [id]);
      if ((owners?.count || 0) <= 1) return reply.code(409).send({ error: "last_owner", message: "必须至少保留一位 Owner" });
    }
    await query(`update workspace_members set role = $1 where workspace_id = $2 and user_id = $3`, [role, id, userId]);
    await audit(user, "workspace.member.role", "workspace", id, { memberUserId: userId, role });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/members/:userId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, userId } = request.params as { id: string; userId: string };
    await assertWorkspace(user, id, "manage", true);
    const current = await one<{ role: "owner" | "editor" | "viewer" }>(`select role from workspace_members where workspace_id = $1 and user_id = $2`, [id, userId]);
    if (!current) return reply.code(404).send({ error: "member_not_found", message: "成员不存在" });
    if (current.role === "owner") {
      const owners = await one<{ count: number }>(`select count(*)::int as count from workspace_members where workspace_id = $1 and role = 'owner'`, [id]);
      if ((owners?.count || 0) <= 1) return reply.code(409).send({ error: "last_owner", message: "必须至少保留一位 Owner" });
    }
    await query(`delete from workspace_members where workspace_id = $1 and user_id = $2`, [id, userId]);
    await audit(user, "workspace.member.remove", "workspace", id, { memberUserId: userId });
    return { ok: true };
  });

  app.get("/api/workspaces/:id/graph", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const workspace = await assertWorkspace(user, id, "read");
    const graphNodes = await query<{ id: string | null; title: string; type: string; format: string; summary: string; asset_id: string; slug: string; created_at: string }>(
      `select node.id, asset.title, asset.type, asset.format, coalesce(asset.summary, node.summary, '') as summary,
              asset.id as asset_id, asset.gbrain_slug as slug, asset.created_at
       from assets asset
       left join graph_nodes node on node.asset_id = asset.id and node.workspace_id = asset.workspace_id
       where asset.workspace_id = $1 and asset.tenant_id = $2 and asset.status = 'ready'
         and asset.deleted_at is null
       order by asset.updated_at desc limit 80`,
      [id, user.tenant_id]
    );
    const graphEdges = await query<{
      id: string;
      source_node_id: string;
      target_node_id: string;
      relation: string;
      evidence: string;
      source: string;
      confidence: number;
    }>(
      `select edge.id, edge.source_node_id, edge.target_node_id, edge.relation, edge.evidence,
              edge.source, edge.confidence
       from graph_edges edge
       join graph_nodes source_node on source_node.id = edge.source_node_id
       join assets source_asset on source_asset.id = source_node.asset_id and source_asset.status = 'ready' and source_asset.deleted_at is null
       join graph_nodes target_node on target_node.id = edge.target_node_id
       join assets target_asset on target_asset.id = target_node.asset_id and target_asset.status = 'ready' and target_asset.deleted_at is null
       where edge.workspace_id = $1 and edge.tenant_id = $2
       order by edge.confidence desc, edge.created_at desc limit 160`,
      [id, user.tenant_id]
    );
    const entityNodes = await query<{ id: string; label: string; type: string; summary: string }>(
      `select 'entity:' || md5(normalized_label || ':' || entity_type) id,
              max(label) label, entity_type type, max(evidence) summary
       from asset_entities ae
       join assets a on a.id = ae.asset_id and a.deleted_at is null and a.status = 'ready'
       where ae.workspace_id = $1 and ae.tenant_id = $2
       group by ae.normalized_label, ae.entity_type
       order by count(*) desc, max(label) limit 160`,
      [id, user.tenant_id]
    );
    const entityEdges = await query<{ id: string; source: string; target: string; label: string; evidence: string }>(
      `select 'entity-edge:' || md5(ae.id) id, gn.id source,
              'entity:' || md5(ae.normalized_label || ':' || ae.entity_type) target,
              case ae.entity_type when 'person' then '人物' when 'sop' then '流程' else '主题' end label,
              ae.evidence
       from asset_entities ae
       join graph_nodes gn on gn.asset_id = ae.asset_id and gn.workspace_id = ae.workspace_id
       join assets a on a.id = ae.asset_id and a.deleted_at is null and a.status = 'ready'
       where ae.workspace_id = $1 and ae.tenant_id = $2
       order by ae.updated_at desc limit 400`,
      [id, user.tenant_id]
    );
    const categoryNodes = await query<{ id: string; parent_id: string | null; label: string }>(
      `select id, parent_id, name label from categories where workspace_id = $1 and tenant_id = $2 order by level, sort_order, name`,
      [id, user.tenant_id]
    );
    const productNodes = await query<{ id: string; category_id: string; label: string }>(
      `select id, category_id, name label from products where workspace_id = $1 and tenant_id = $2 order by sort_order, name`,
      [id, user.tenant_id]
    );
    const assetProductEdges = await query<{ id: string; source: string; product_id: string; title: string }>(
      `select 'asset-product:' || md5(a.id) id, gn.id source, a.product_id, a.title
       from assets a join graph_nodes gn on gn.asset_id = a.id
       where a.workspace_id = $1 and a.tenant_id = $2 and a.product_id is not null and a.deleted_at is null and a.status = 'ready'`,
      [id, user.tenant_id]
    );
    const center = { id: workspace.id, label: workspace.name, type: "workspace", summary: workspace.description, assetId: null, slug: workspace.gbrain_source_id };
    const nodeIds = new Map(graphNodes.map((node) => [node.asset_id, node.id || `asset:${node.asset_id}`]));
    const nodes = [
      center,
      ...graphNodes.map((node) => ({
        id: node.id || `asset:${node.asset_id}`,
        label: node.title,
        type: node.type,
        format: node.format,
        summary: node.summary,
        assetId: node.asset_id,
        slug: node.slug
      })),
      ...entityNodes.map((node) => ({ id: node.id, label: node.label, type: node.type || "topic", summary: node.summary || "抽取实体", assetId: null })),
      ...categoryNodes.map((node) => ({ id: `category:${node.id}`, label: node.label, type: "category", summary: "图片素材类目", assetId: null })),
      ...productNodes.map((node) => ({ id: `product:${node.id}`, label: node.label, type: "product", summary: "图片素材商品", assetId: null }))
    ];
    const edges = [
      ...graphNodes.map((node) => ({ id: `${workspace.id}-${node.asset_id}`, source: workspace.id, target: nodeIds.get(node.asset_id)!, label: "沉淀", evidence: "真实 Workspace 资产", sourceType: "workspace", confidence: 1 })),
      ...graphEdges.map((edge) => ({
        id: edge.id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        label: edge.relation,
        evidence: edge.evidence,
        sourceType: edge.source,
        confidence: Number(edge.confidence)
      })),
      ...entityEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, evidence: edge.evidence, sourceType: "entity", confidence: 0.8 })),
      ...categoryNodes.filter((node) => node.parent_id).map((node) => ({ id: `category-parent:${node.id}`, source: `category:${node.id}`, target: `category:${node.parent_id}`, label: "上级类目", evidence: "类目层级", sourceType: "catalog", confidence: 1 })),
      ...productNodes.map((node) => ({ id: `product-category:${node.id}`, source: `product:${node.id}`, target: `category:${node.category_id}`, label: "所属类目", evidence: "商品类目", sourceType: "catalog", confidence: 1 })),
      ...assetProductEdges.map((edge) => ({ id: edge.id, source: edge.source, target: `product:${edge.product_id}`, label: "商品素材", evidence: edge.title, sourceType: "catalog", confidence: 1 }))
    ];
    return { nodes, edges };
  });
}
