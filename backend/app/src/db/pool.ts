import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { env } from "../config/env.js";
import { dbAcquireDuration, dbTransactionDuration, updateDbPoolMetrics } from "../observability/registry.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || 1000);

export const pool = new Pool({
  ...(env.database.url
    ? { connectionString: env.database.url }
    : {
        host: env.database.host,
        port: env.database.port,
        database: env.database.name,
        user: env.database.user,
        password: env.database.password
      }),
  max: env.database.poolMax,
  connectionTimeoutMillis: env.database.connectionTimeoutMs,
  idleTimeoutMillis: env.database.idleTimeoutMs,
  allowExitOnIdle: false
});

function poolMetrics() {
  updateDbPoolMetrics({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
}

async function connect() {
  const startedAt = process.hrtime.bigint();
  try {
    return await pool.connect();
  } finally {
    dbAcquireDuration.observe(Number(process.hrtime.bigint() - startedAt) / 1e9);
    poolMetrics();
  }
}

interface DbContext {
  system: boolean;
  tenantId?: string;
  userId?: string;
}

const dbContext = new AsyncLocalStorage<DbContext>();

export function withDbRequestContext<T>(fn: () => T) {
  return dbContext.run({ system: false }, fn);
}

export function setDbIdentity(tenantId: string, userId: string) {
  const context = dbContext.getStore();
  if (!context) return;
  context.system = false;
  context.tenantId = tenantId;
  context.userId = userId;
}

export function runAsSystem<T>(fn: () => T) {
  return dbContext.run({ system: true }, fn);
}

function activeContext(): DbContext {
  // CLI migrations, maintenance scripts and boot-time workers run outside an HTTP
  // request. They are explicit system work; HTTP requests always receive a
  // non-system context from withDbRequestContext.
  return dbContext.getStore() || { system: true };
}

async function applyContext(client: pg.PoolClient) {
  const context = activeContext();
  // The connection account may own the schema for local migrations. Queries are
  // deliberately downgraded to a non-owner role so FORCE ROW LEVEL SECURITY is
  // effective in development and production alike.
  await client.query(`set local role aiteam_runtime`);
  await client.query(
    `select set_config('app.system', $1, true),
            set_config('app.tenant_id', $2, true),
            set_config('app.user_id', $3, true),
            set_config('statement_timeout', $4, true),
            set_config('lock_timeout', $5, true),
            set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
    [
      context.system ? "true" : "false",
      context.tenantId || "",
      context.userId || "",
      `${env.database.statementTimeoutMs}ms`,
      `${env.database.lockTimeoutMs}ms`
    ]
  );
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const client = await connect();
  const startedAt = process.hrtime.bigint();
  let outcome = "success";
  try {
    await client.query("begin");
    await applyContext(client);
    const result = await client.query(text, params);
    await client.query("commit");
    return result.rows as T[];
  } catch (error) {
    outcome = "error";
    await client.query("rollback");
    throw error;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbTransactionDuration.observe({ outcome }, durationMs / 1000);

    // 慢查询日志
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      const context = activeContext();
      logger.warn({
        durationMs: Math.round(durationMs),
        query: text.slice(0, 500),
        paramCount: params.length,
        tenantId: context.tenantId,
        userId: context.userId,
        outcome
      }, "Slow query detected");
    }

    client.release();
    poolMetrics();
  }
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await connect();
  const startedAt = process.hrtime.bigint();
  let outcome = "success";
  try {
    await client.query("begin");
    await applyContext(client);
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    outcome = "error";
    await client.query("rollback");
    throw error;
  } finally {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    dbTransactionDuration.observe({ outcome }, durationMs / 1000);

    // 慢事务日志
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      const context = activeContext();
      logger.warn({
        durationMs: Math.round(durationMs),
        type: "transaction",
        tenantId: context.tenantId,
        userId: context.userId,
        outcome
      }, "Slow transaction detected");
    }

    client.release();
    poolMetrics();
  }
}
