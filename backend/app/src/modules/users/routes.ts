import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { audit, requireAdmin, requireUser, toPublicUser } from "../../auth/context.js";
import { hashPassword } from "../../auth/password.js";
import { one, query } from "../../db/pool.js";
import type { User, UserRole } from "../../db/schema.js";
import { createId } from "../../utils/id.js";
import { ensureStoredFile, removeStoredFile, writeStoredBuffer } from "../../services/storage.js";

const roleSchema = z.enum(["admin", "editor", "viewer"]);
const statusSchema = z.enum(["active", "disabled"]);
const avatarPresetIds = ["indigo", "jade", "sunset", "ocean", "plum", "citrus", "slate", "rose"] as const;
const avatarPreferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("initials") }),
  z.object({ type: z.literal("preset"), value: z.enum(avatarPresetIds) })
]);

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(6).max(128),
  role: roleSchema.default("viewer"),
  status: statusSchema.default("active")
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  password: z.string().min(6).max(128).optional(),
  role: roleSchema.optional(),
  status: statusSchema.optional()
}).refine((body) => Object.keys(body).length > 0, "至少提供一个修改项");

type ManagedUser = Omit<User, "password_hash"> & { resource_count: number };

async function listUsers(tenantId: string) {
  return query<ManagedUser>(
    `select u.id, u.tenant_id, u.email, u.name, u.role, u.is_admin, u.status, u.avatar_type, u.avatar_value, u.created_at,
            ((select count(*) from workspaces w where w.owner_id = u.id) +
             (select count(*) from notes n where n.owner_id = u.id) +
             (select count(*) from assets a where a.owner_id = u.id))::int as resource_count
       from users u
      where u.tenant_id = $1
      order by case u.role when 'admin' then 0 when 'editor' then 1 else 2 end, u.created_at`,
    [tenantId]
  );
}

async function replaceAvatar(user: User, type: User["avatar_type"], value: string | null) {
  const updated = await one<User>(
    `update users set avatar_type = $1, avatar_value = $2 where id = $3 and tenant_id = $4 returning *`,
    [type, value, user.id, user.tenant_id]
  );
  if (user.avatar_type === "upload" && user.avatar_value && user.avatar_value !== value && user.avatar_value.startsWith(`avatars/${user.tenant_id}/${user.id}/`)) {
    await removeStoredFile(user.avatar_value).catch(() => undefined);
  }
  return updated;
}

async function activeAdminCount(tenantId: string) {
  const result = await one<{ count: number }>(
    `select count(*)::int as count from users where tenant_id = $1 and role = 'admin' and status = 'active'`,
    [tenantId]
  );
  return result?.count || 0;
}

function duplicateEmail(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users/:id/avatar", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const target = await one<Pick<User, "avatar_type" | "avatar_value">>(
      `select avatar_type, avatar_value from users where id = $1 and tenant_id = $2`,
      [id, user.tenant_id]
    );
    if (!target || target.avatar_type !== "upload" || !target.avatar_value) {
      return reply.code(404).send({ error: "avatar_not_found", message: "头像不存在" });
    }
    const absolutePath = await ensureStoredFile(target.avatar_value).catch(() => "");
    if (!absolutePath) return reply.code(404).send({ error: "avatar_not_found", message: "头像文件不存在" });
    reply.header("cache-control", "private, max-age=86400");
    reply.type("image/webp");
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.post("/api/me/avatar", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "missing_avatar", message: "请选择头像图片" });
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.mimetype)) {
      file.file.resume();
      return reply.code(415).send({ error: "invalid_avatar_type", message: "头像仅支持 JPG、PNG 或 WebP" });
    }
    const bytes = await file.toBuffer();
    if (file.file.truncated || bytes.length > 5 * 1024 * 1024) return reply.code(413).send({ error: "avatar_too_large", message: "头像文件不能超过 5MB" });
    let output: Buffer;
    try {
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64) {
        return reply.code(400).send({ error: "avatar_too_small", message: "头像尺寸不能小于 64×64" });
      }
      output = await sharp(bytes).rotate().resize(512, 512, { fit: "cover", position: "centre" }).webp({ quality: 86 }).toBuffer();
    } catch {
      return reply.code(415).send({ error: "invalid_avatar", message: "无法读取头像图片" });
    }
    const storageKey = `avatars/${user.tenant_id}/${user.id}/${createId("avatar")}.webp`;
    await writeStoredBuffer(storageKey, output);
    const updated = await replaceAvatar(user, "upload", storageKey);
    if (!updated) throw new Error("头像保存失败");
    await audit(user, "user.avatar.upload", "user", user.id);
    return { user: toPublicUser(updated) };
  });

  app.patch("/api/me/avatar", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = avatarPreferenceSchema.parse(request.body);
    const updated = await replaceAvatar(user, body.type, body.type === "preset" ? body.value : null);
    if (!updated) throw new Error("头像保存失败");
    await audit(user, "user.avatar.preference", "user", user.id, body);
    return { user: toPublicUser(updated) };
  });

  app.delete("/api/me/avatar", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const updated = await replaceAvatar(user, "initials", null);
    if (!updated) throw new Error("头像重置失败");
    await audit(user, "user.avatar.reset", "user", user.id);
    return { user: toPublicUser(updated) };
  });

  app.get("/api/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    return { users: await listUsers(admin.tenant_id) };
  });

  app.post("/api/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const body = createUserSchema.parse(request.body);
    try {
      const user = await one<User>(
        `insert into users (id, tenant_id, email, name, password_hash, role, is_admin, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [createId("user"), admin.tenant_id, body.email, body.name, hashPassword(body.password), body.role, body.role === "admin", body.status]
      );
      if (!user) throw new Error("用户创建失败");
      await audit(admin, "user.create", "user", user.id, { email: user.email, role: user.role });
      return reply.code(201).send({ user: { ...toPublicUser(user), resource_count: 0 } });
    } catch (error) {
      if (duplicateEmail(error)) return reply.code(409).send({ error: "email_exists", message: "该邮箱已存在" });
      throw error;
    }
  });

  app.patch("/api/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);
    const current = await one<User>(`select * from users where id = $1 and tenant_id = $2`, [id, admin.tenant_id]);
    if (!current) return reply.code(404).send({ error: "user_not_found", message: "用户不存在" });
    const nextRole: UserRole = body.role || current.role;
    const nextStatus = body.status || current.status;
    if (id === admin.id && (nextRole !== "admin" || nextStatus !== "active")) {
      return reply.code(409).send({ error: "self_lockout", message: "不能停用或降级当前管理员" });
    }
    if (current.role === "admin" && current.status === "active" && (nextRole !== "admin" || nextStatus !== "active") && await activeAdminCount(admin.tenant_id) <= 1) {
      return reply.code(409).send({ error: "last_admin", message: "必须至少保留一位启用中的管理员" });
    }
    try {
      const user = await one<User>(
        `update users
            set name = coalesce($1, name), email = coalesce($2, email),
                password_hash = coalesce($3, password_hash), role = $4, is_admin = $5, status = $6
          where id = $7 and tenant_id = $8 returning *`,
        [body.name, body.email, body.password ? hashPassword(body.password) : null, nextRole, nextRole === "admin", nextStatus, id, admin.tenant_id]
      );
      if (body.password || nextStatus === "disabled") await query(`delete from sessions where user_id = $1`, [id]);
      await audit(admin, "user.update", "user", id, { role: nextRole, status: nextStatus });
      return { user: user ? { ...toPublicUser(user), resource_count: 0 } : null };
    } catch (error) {
      if (duplicateEmail(error)) return reply.code(409).send({ error: "email_exists", message: "该邮箱已存在" });
      throw error;
    }
  });

  app.delete("/api/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return;
    const { id } = request.params as { id: string };
    if (id === admin.id) return reply.code(409).send({ error: "self_delete", message: "不能删除当前管理员" });
    const target = await one<User>(`select * from users where id = $1 and tenant_id = $2`, [id, admin.tenant_id]);
    if (!target) return reply.code(404).send({ error: "user_not_found", message: "用户不存在" });
    if (target.role === "admin" && target.status === "active" && await activeAdminCount(admin.tenant_id) <= 1) {
      return reply.code(409).send({ error: "last_admin", message: "必须至少保留一位启用中的管理员" });
    }
    const usage = await one<{ count: number }>(
      `select ((select count(*) from workspaces where owner_id = $1) +
               (select count(*) from assets where owner_id = $1) +
               (select count(*) from conversations where user_id = $1) +
               (select count(*) from notes where owner_id = $1))::int as count`,
      [id]
    );
    if ((usage?.count || 0) > 0) {
      return reply.code(409).send({ error: "user_has_content", message: "该用户仍拥有内容，请先停用账号或转移内容" });
    }
    await query(`delete from users where id = $1 and tenant_id = $2`, [id, admin.tenant_id]);
    await audit(admin, "user.delete", "user", id, { email: target.email });
    return { ok: true };
  });
}
