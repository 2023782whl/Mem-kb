import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { one, query, runAsSystem, setDbIdentity } from "../db/pool.js";
import type { User } from "../db/schema.js";
import { randomToken, sha256 } from "../utils/crypto.js";
import { createId } from "../utils/id.js";

export type AuthUser = Omit<User, "password_hash">;

export function toPublicUser(user: User): AuthUser {
  const { password_hash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export async function createSession(userId: string, remember = false) {
  const token = randomToken();
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  const expiresAt = new Date(Date.now() + 1000 * maxAge).toISOString();
  await runAsSystem(() => query(
    `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)`,
    [createId("session"), userId, sha256(token), expiresAt]
  ));
  return { token, expiresAt, maxAge };
}

function readToken(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return request.cookies?.aiteam_session;
}

export async function getCurrentUser(request: FastifyRequest) {
  const token = readToken(request);
  if (!token) return null;
  const user = await runAsSystem(() => one<User>(
    `select u.*
     from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
    [sha256(token)]
  ));
  if (user) setDbIdentity(user.tenant_id, user.id);
  return user;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(request);
  if (!user) {
    reply.code(401).send({ error: "unauthorized", message: "请先登录" });
    return null;
  }
  return user;
}

export function isAdminUser(user: Pick<User, "role" | "is_admin">) {
  return user.role === "admin" || user.is_admin;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply);
  if (!user) return null;
  if (!isAdminUser(user)) {
    reply.code(403).send({ error: "permission_denied", message: "仅系统管理员可以执行此操作" });
    return null;
  }
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAge: number) {
  reply.setCookie("aiteam_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.runtime === "production" || env.frontendOrigin.startsWith("https://"),
    path: "/",
    maxAge
  });
}

export async function audit(
  user: Pick<User, "id" | "tenant_id"> | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
) {
  await query(
    `insert into audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      createId("audit"),
      user?.tenant_id || "tenant-zw",
      user?.id || null,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata)
    ]
  );
}
