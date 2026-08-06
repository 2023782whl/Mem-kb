import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, createSession, requireUser, setSessionCookie, toPublicUser } from "../../auth/context.js";
import { env } from "../../config/env.js";
import { verifyPassword } from "../../auth/password.js";
import { one, query, runAsSystem, setDbIdentity } from "../../db/pool.js";
import type { User } from "../../db/schema.js";

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  remember: z.boolean().default(false)
});

export function resolveLoginEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return normalized === "admin" ? "admin@mem-kb.local" : normalized;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const email = resolveLoginEmail(body.email);
    const user = await runAsSystem(() => one<User>(`select * from users where email = $1 and status = 'active'`, [email]));
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      reply.code(401).send({ error: "invalid_credentials", message: "账号或密码错误" });
      return;
    }

    setDbIdentity(user.tenant_id, user.id);
    const session = await createSession(user.id, body.remember);
    setSessionCookie(reply, session.token, session.maxAge);
    await audit(user, "auth.login", "user", user.id);
    return { user: toPublicUser(user), expiresAt: session.expiresAt };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") || request.cookies?.aiteam_session;
    if (token) {
      const { sha256 } = await import("../../utils/crypto.js");
      await query(`delete from sessions where token_hash = $1`, [sha256(token)]);
    }
    reply.clearCookie("aiteam_session", {
      path: "/",
      sameSite: "strict",
      secure: env.runtime === "production" || env.frontendOrigin.startsWith("https://")
    });
    await audit(user, "auth.logout", "user", user.id);
    return { ok: true };
  });

  app.get("/api/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    return { user: toPublicUser(user) };
  });
}
