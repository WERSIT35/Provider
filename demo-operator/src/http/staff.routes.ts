import type { FastifyPluginAsync } from "fastify";
import { StaffAuth, STAFF_COOKIE, clearedCookie, readCookie, sessionCookie } from "../auth/staff-auth";

/** Back-office sign-in: POST /api/staff/login, POST /api/staff/logout, GET /api/staff/me. */
export default function staffRoutes(auth: StaffAuth): FastifyPluginAsync {
  return async (app) => {
    app.post("/api/staff/login", async (req, reply) => {
      const body = (req.body ?? {}) as { username?: string; password?: string };
      if (typeof body.username !== "string" || typeof body.password !== "string" || !body.username || !body.password) {
        return reply.code(422).send({ error: { code: "VALIDATION", message: "username and password required" } });
      }
      let session;
      try {
        session = auth.login(body.username, body.password, req.ip);
      } catch {
        return reply.code(429).send({ error: { code: "TOO_MANY_ATTEMPTS", message: "too many failed sign-ins; try again in a few minutes" } });
      }
      if (!session) return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "wrong username or password" } });
      reply.header("set-cookie", sessionCookie(session.token, session.expiresAt, req.protocol === "https"));
      return { username: body.username, expiresAt: session.expiresAt };
    });

    app.post("/api/staff/logout", async (req, reply) => {
      auth.logout(readCookie(req, STAFF_COOKIE));
      reply.header("set-cookie", clearedCookie(req.protocol === "https"));
      return { ok: true };
    });

    app.get("/api/staff/me", async (req, reply) => {
      const user = auth.verify(readCookie(req, STAFF_COOKIE));
      if (!user) return reply.code(401).send({ error: { code: "STAFF_AUTH_REQUIRED", message: "not signed in" } });
      return { username: user };
    });
  };
}
