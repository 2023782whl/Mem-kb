import { hashPassword } from "../auth/password.js";
import { pool, one, query } from "./pool.js";
import { createId } from "../utils/id.js";
import { logger } from "../utils/logger.js";

async function createAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = (process.env.ADMIN_NAME || "系统管理员").trim();
  const tenantId = (process.env.ADMIN_TENANT_ID || "tenant-production").trim();
  const tenantName = (process.env.ADMIN_TENANT_NAME || "Mem-kb").trim();
  if (!email || !email.includes("@")) throw new Error("ADMIN_EMAIL 必须是有效邮箱");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD 至少需要 12 位");
  if (!tenantId || !tenantName || !name) throw new Error("管理员与租户名称不能为空");

  await query(`insert into tenants (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name`, [tenantId, tenantName]);
  const admin = await one<{ id: string; email: string }>(
    `insert into users (id, tenant_id, email, name, password_hash, role, is_admin, status)
     values ($1, $2, $3, $4, $5, 'admin', true, 'active')
     on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash,
       role = 'admin', is_admin = true, status = 'active'
     returning id, email`,
    [createId("user"), tenantId, email, name, hashPassword(password)]
  );
  if (!admin) throw new Error("管理员创建失败");
  logger.info({ email: admin.email }, "Administrator ready");
}

if (/create-admin\.(ts|js)$/.test(process.argv[1] || "")) {
  try {
    await createAdmin();
  } finally {
    await pool.end();
  }
}
