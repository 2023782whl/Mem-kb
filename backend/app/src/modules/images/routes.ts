import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one, query } from "../../db/pool.js";
import type { Asset, Category, Product } from "../../db/schema.js";
import { embedMultimodal } from "../../providers/embedding.js";
import { searchImagesByText, searchImagesByVector } from "../../services/image-search.js";
import { createId } from "../../utils/id.js";

export async function registerImageRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/categories", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "read");
    return { categories: await query<Category>(`select * from categories where tenant_id = $1 and workspace_id = $2 order by level, sort_order, name`, [user.tenant_id, id]) };
  });

  app.post("/api/workspaces/:id/categories", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "write");
    const body = z.object({ name: z.string().min(1).max(80), parentId: z.string().nullable().optional() }).parse(request.body);
    let level = 1;
    if (body.parentId) {
      const parent = await one<Category>(`select * from categories where id = $1 and tenant_id = $2 and workspace_id = $3`, [body.parentId, user.tenant_id, id]);
      if (!parent || parent.level >= 3) return reply.code(400).send({ error: "invalid_parent", message: "类目最多三级" });
      level = parent.level + 1;
    }
    const category = await one<Category>(
      `insert into categories (id, tenant_id, workspace_id, parent_id, level, name) values ($1,$2,$3,$4,$5,$6) returning *`,
      [createId("category"), user.tenant_id, id, body.parentId || null, level, body.name]
    );
    await audit(user, "category.create", "category", category!.id, { workspaceId: id, level });
    return { category };
  });

  app.patch("/api/workspaces/:id/categories/:categoryId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, categoryId } = request.params as { id: string; categoryId: string };
    await assertWorkspace(user, id, "write");
    const body = z.object({ name: z.string().min(1).max(80).optional(), sortOrder: z.number().int().min(0).max(1_000_000).optional() }).parse(request.body);
    const category = await one<Category>(
      `update categories set name = coalesce($1, name), sort_order = coalesce($2, sort_order)
       where id = $3 and tenant_id = $4 and workspace_id = $5 returning *`,
      [body.name || null, body.sortOrder ?? null, categoryId, user.tenant_id, id]
    );
    if (!category) return reply.code(404).send({ error: "category_not_found", message: "类目不存在" });
    await audit(user, "category.update", "category", categoryId, { workspaceId: id, ...body });
    return { category };
  });

  app.delete("/api/workspaces/:id/categories/:categoryId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, categoryId } = request.params as { id: string; categoryId: string };
    await assertWorkspace(user, id, "write");
    const usage = await one<{ children: number; products: number; assets: number }>(
      `select (select count(*)::int from categories where parent_id = $1) children,
              (select count(*)::int from products where category_id = $1) products,
              (select count(*)::int from assets where category_id = $1 and deleted_at is null) assets`,
      [categoryId]
    );
    if ((usage?.children || 0) + (usage?.products || 0) + (usage?.assets || 0) > 0) {
      return reply.code(409).send({ error: "category_not_empty", message: "类目仍包含下级类目、商品或素材" });
    }
    const deleted = await one<{ id: string }>(`delete from categories where id = $1 and tenant_id = $2 and workspace_id = $3 returning id`, [categoryId, user.tenant_id, id]);
    if (!deleted) return reply.code(404).send({ error: "category_not_found", message: "类目不存在" });
    await audit(user, "category.delete", "category", categoryId, { workspaceId: id });
    return { ok: true };
  });

  app.get("/api/workspaces/:id/products", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const { categoryId } = z.object({ categoryId: z.string().optional() }).parse(request.query);
    await assertWorkspace(user, id, "read");
    return {
      products: await query<Product>(
        `select * from products where tenant_id = $1 and workspace_id = $2 and ($3::text is null or category_id = $3) order by sort_order, name`,
        [user.tenant_id, id, categoryId || null]
      )
    };
  });

  app.post("/api/workspaces/:id/products", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    await assertWorkspace(user, id, "write");
    const body = z.object({ categoryId: z.string(), name: z.string().min(1).max(120) }).parse(request.body);
    const category = await one<Category>(`select * from categories where id = $1 and tenant_id = $2 and workspace_id = $3 and level = 3`, [body.categoryId, user.tenant_id, id]);
    if (!category) return reply.code(400).send({ error: "leaf_category_required", message: "商品必须创建在三级类目下" });
    const product = await one<Product>(
      `insert into products (id, tenant_id, workspace_id, category_id, name) values ($1,$2,$3,$4,$5) returning *`,
      [createId("product"), user.tenant_id, id, body.categoryId, body.name]
    );
    return { product };
  });

  app.patch("/api/workspaces/:id/products/:productId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, productId } = request.params as { id: string; productId: string };
    await assertWorkspace(user, id, "write");
    const body = z.object({ name: z.string().min(1).max(120).optional(), categoryId: z.string().optional(), sortOrder: z.number().int().min(0).max(1_000_000).optional() }).parse(request.body);
    if (body.categoryId) {
      const category = await one<Category>(`select * from categories where id = $1 and tenant_id = $2 and workspace_id = $3 and level = 3`, [body.categoryId, user.tenant_id, id]);
      if (!category) return reply.code(400).send({ error: "leaf_category_required", message: "商品必须归属于三级类目" });
    }
    const product = await one<Product>(
      `update products set name = coalesce($1, name), category_id = coalesce($2, category_id), sort_order = coalesce($3, sort_order)
       where id = $4 and tenant_id = $5 and workspace_id = $6 returning *`,
      [body.name || null, body.categoryId || null, body.sortOrder ?? null, productId, user.tenant_id, id]
    );
    if (!product) return reply.code(404).send({ error: "product_not_found", message: "商品不存在" });
    if (body.categoryId) await query(`update assets set category_id = $1, updated_at = now() where product_id = $2 and workspace_id = $3`, [body.categoryId, productId, id]);
    await audit(user, "product.update", "product", productId, { workspaceId: id, ...body });
    return { product };
  });

  app.delete("/api/workspaces/:id/products/:productId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, productId } = request.params as { id: string; productId: string };
    await assertWorkspace(user, id, "write");
    const usage = await one<{ assets: number }>(`select count(*)::int assets from assets where product_id = $1 and deleted_at is null`, [productId]);
    if ((usage?.assets || 0) > 0) return reply.code(409).send({ error: "product_not_empty", message: "商品仍关联素材，请先移动素材" });
    const deleted = await one<{ id: string }>(`delete from products where id = $1 and tenant_id = $2 and workspace_id = $3 returning id`, [productId, user.tenant_id, id]);
    if (!deleted) return reply.code(404).send({ error: "product_not_found", message: "商品不存在" });
    await audit(user, "product.delete", "product", productId, { workspaceId: id });
    return { ok: true };
  });

  app.post("/api/image-search/text", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = z.object({ workspaceId: z.string(), query: z.string().min(1).max(1000) }).parse(request.body);
    await assertWorkspace(user, body.workspaceId, "read");
    return { assets: await searchImagesByText(user.tenant_id, body.workspaceId, body.query) };
  });

  app.post("/api/image-search/image", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "missing_file", message: "请选择参考图片" });
    const workspaceField = file.fields.workspaceId as { value?: unknown } | undefined;
    const workspaceId = typeof workspaceField?.value === "string" ? workspaceField.value : "";
    await assertWorkspace(user, workspaceId, "read");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aiteam-image-search-"));
    const tempPath = path.join(tempDir, file.filename || "query-image");
    try {
      await fs.writeFile(tempPath, await file.toBuffer());
      const vector = await embedMultimodal({ imagePath: tempPath });
      return { assets: await searchImagesByVector(user.tenant_id, workspaceId, vector) };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}
