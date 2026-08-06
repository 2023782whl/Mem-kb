import pg from "pg";
import { env } from "../config/env.js";
import { hashPassword } from "../auth/password.js";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

function adminPool() {
  return new Pool({
    host: env.database.host,
    port: env.database.port,
    database: "postgres",
    user: env.database.user,
    password: env.database.password
  });
}

function appPool() {
  return new Pool(
    env.database.url
      ? { connectionString: env.database.url }
      : {
          host: env.database.host,
          port: env.database.port,
          database: env.database.name,
          user: env.database.user,
          password: env.database.password
        }
  );
}

export async function ensureDatabase() {
  const pool = adminPool();
  try {
    const existing = await pool.query("select 1 from pg_database where datname = $1", [env.database.name]);
    if (existing.rowCount === 0) {
      const safeName = `"${env.database.name.replace(/"/g, '""')}"`;
      await pool.query(`create database ${safeName}`);
    }
  } finally {
    await pool.end();
  }
}

export async function migrateAndSeed() {
  const pool = appPool();
  const client = await pool.connect();
  try {
    await runMigrations(client);
    await seed(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function migrateOnly() {
  const pool = appPool();
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seed(client: pg.PoolClient) {
  await client.query(`insert into tenants (id, name) values ($1, $2) on conflict (id) do nothing`, [
    "tenant-zw",
    "Mem-kb"
  ]);

  await client.query(
    `insert into users (id, tenant_id, email, name, password_hash, role, is_admin)
     values ('user-admin', 'tenant-zw', 'admin@mem-kb.local', '系统管理员', $1, 'admin', true)
     on conflict (id) do update set email = excluded.email, name = excluded.name,
       password_hash = excluded.password_hash, role = 'admin', is_admin = true, status = 'active'`,
    [hashPassword("admin123456")]
  );

  await client.query(
    `insert into users (id, tenant_id, email, name, password_hash, role, is_admin)
     values ('user-viewer', 'tenant-zw', 'viewer@mem-kb.local', '只读成员', $1, 'viewer', false)
     on conflict (id) do update set email = excluded.email, name = excluded.name,
       password_hash = excluded.password_hash, role = 'viewer', is_admin = false, status = 'active'`,
    [hashPassword("viewer123456")]
  );

  await client.query(
    `insert into business_units (id, tenant_id, name, description)
     values ('bu-ecommerce', 'tenant-zw', '电商运营中心', '电商运营、客服和素材业务分区。')
     on conflict (id) do nothing`
  );
  await client.query(
    `insert into business_unit_members (business_unit_id, user_id, role)
     values ('bu-ecommerce', 'user-admin', 'owner')
     on conflict (business_unit_id, user_id) do update set role = 'owner'`
  );

  const workspaces = [
    ["ws-ecom-ops", "user-admin", "电商运营知识库", "团队 SOP、活动复盘、运营策略沉淀。", "team", "document"],
    ["ws-service", "user-admin", "电商客服知识库", "客服话术、售后流程和常见问题。", "team", "document"],
    ["ws-personal-ops", "user-admin", "个人运营打法", "个人策略、选品观察和可复用打法。", "personal", "document"],
    ["ws-ecom-images", "user-admin", "电商素材库", "商品主图、场景图和活动素材沉淀。", "team", "image"]
  ] as const;

  for (const [id, ownerId, name, description, scope, kind] of workspaces) {
    await client.query(
      `insert into workspaces (id, tenant_id, owner_id, name, description, scope, kind, gbrain_source_id)
       values ($1, 'tenant-zw', $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [id, ownerId, name, description, scope, kind, `tenant/tenant-zw/workspace/${id}`]
    );
  }

  await client.query(
    `update workspaces set business_unit_id = 'bu-ecommerce'
     where id in ('ws-ecom-ops', 'ws-service', 'ws-ecom-images') and business_unit_id is null`
  );

  const members = [
    ["ws-ecom-ops", "user-admin", "owner"],
    ["ws-service", "user-admin", "owner"],
    ["ws-personal-ops", "user-admin", "owner"],
    ["ws-ecom-images", "user-admin", "owner"],
    ["ws-ecom-ops", "user-viewer", "viewer"],
    ["ws-service", "user-viewer", "viewer"],
    ["ws-ecom-images", "user-viewer", "viewer"],
  ] as const;
  for (const [workspaceId, userId, role] of members) {
    await client.query(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, $3)
       on conflict (workspace_id, user_id) do nothing`,
      [workspaceId, userId, role]
    );
  }

  const categories = [
    ["cat-apparel", null, 1, "服饰"],
    ["cat-outdoor", "cat-apparel", 2, "户外服饰"],
    ["cat-suncoat", "cat-outdoor", 3, "防晒衣"]
  ] as const;
  for (const [id, parentId, level, name] of categories) {
    await client.query(
      `insert into categories (id, tenant_id, workspace_id, parent_id, level, name)
       values ($1, 'tenant-zw', 'ws-ecom-images', $2, $3, $4) on conflict (id) do nothing`,
      [id, parentId, level, name]
    );
  }
  await client.query(
    `insert into products (id, tenant_id, workspace_id, category_id, name)
     values ('product-suncoat', 'tenant-zw', 'ws-ecom-images', 'cat-suncoat', '轻薄冰感防晒衣')
     on conflict (id) do nothing`
  );

  const samples = [
    ["asset-seed-1", "淘宝搜索主图优化SOP.md", "搜索主图优化流程：先定位叶子类目，再拆解点击率、卖点、场景图和竞品表达，最后形成可复用检查清单。"],
    ["asset-seed-2", "防晒衣标题关键词库.md", "防晒衣标题关键词库覆盖防晒指数、冰感、轻薄、通勤、户外、显瘦等关键词组合，并记录适用场景。"],
    ["asset-seed-3", "夏季活动节奏复盘.pdf", "夏季活动复盘关注流量入口、转化节点、商品承接、客服响应和二次投放动作。"],
    ["asset-seed-4", "竞品卖点拆解表.xlsx", "竞品卖点拆解包含价格带、核心卖点、主图结构、标题词根和用户评价高频词。"],
    ["asset-seed-5", "直播间脚本模板.docx", "直播间脚本模板包含开场、痛点引入、卖点讲解、福利机制、逼单话术和复盘字段。"],
    ["asset-seed-6", "商品卖点禁用词.md", "商品卖点禁用词用于规避绝对化、医疗化和无法证明的功效表达，保障素材上线安全。"]
  ] as const;

  for (const [id, title, text] of samples) {
    await client.query(
      `insert into assets
       (id, tenant_id, workspace_id, owner_id, type, format, title, mime_type, size_bytes, storage_key,
        sha256, status, summary, extracted_text, gbrain_slug)
       values ($1, 'tenant-zw', 'ws-ecom-ops', 'user-admin', 'document', 'md', $2, 'text/markdown',
        length($3), $4, md5($3), 'ready', $5, $3, $6)
       on conflict (id) do nothing`,
      [
        id,
        title,
        text,
        `seed/${id}.md`,
        text.slice(0, 100),
        `aiteam/tenant-zw/workspace/ws-ecom-ops/assets/${id}`
      ]
    );
  }
}

if (/setup\.(ts|js)$/.test(process.argv[1] || "")) {
  await ensureDatabase();
  if (env.runtime === "production") await migrateOnly();
  else await migrateAndSeed();
  console.log(`Database ready: ${env.database.name}`);
}
