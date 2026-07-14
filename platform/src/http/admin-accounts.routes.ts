import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { envelope } from "./errors";
import { adminBearerAuth } from "./auth";
import { can, type AdminClaims, type AdminRole } from "../modules/admin/admin-auth";

/**
 * Admin-account management (provider-only). Only a provider_super_admin holds
 * `admin_accounts.manage` (via the "*" grant), so operator admins can never mint
 * or escalate accounts. Operator-scoped accounts are pinned to an operator_id and
 * may only carry operator_* roles.
 */

const PROVIDER_ROLES: AdminRole[] = ["provider_super_admin", "provider_finance", "provider_read_only"];
const OPERATOR_ROLES: AdminRole[] = ["operator_admin", "operator_finance", "operator_viewer"];

const createBody = z.object({
  username: z.string().min(3).max(64),
  scope: z.enum(["provider", "operator"]),
  operator_id: z.string().optional(),
  role: z.enum([
    "provider_super_admin",
    "provider_finance",
    "provider_read_only",
    "operator_admin",
    "operator_finance",
    "operator_viewer"
  ])
});

function forbid(reply: FastifyReply, req: FastifyRequest, message: string): FastifyReply {
  return reply.code(403).send(envelope("FORBIDDEN", message, req.id));
}

const adminAccountRoutes: FastifyPluginAsync = async (app) => {
  const auth = adminBearerAuth(app.container);

  // Every route here is provider-super-admin only.
  const guard = (req: FastifyRequest, reply: FastifyReply): AdminClaims | null => {
    const claims = req.adminClaims as AdminClaims;
    if (claims.scope !== "provider" || !can(claims, "admin_accounts.manage")) {
      forbid(reply, req, "admin_accounts.manage (provider super-admin) required");
      return null;
    }
    return claims;
  };

  app.get("/admin/v1/admin-accounts", { preHandler: auth }, async (req, reply) => {
    if (!guard(req, reply)) return reply;
    const q = req.query as { scope?: "provider" | "operator"; operator_id?: string };
    return { accounts: app.container.adminAccounts.list({ scope: q.scope, operator_id: q.operator_id }) };
  });

  app.post("/admin/v1/admin-accounts", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply);
    if (!claims) return reply;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(envelope("BAD_REQUEST", "username (3-64), scope, and a matching role are required", req.id));
    }
    const { username, scope, operator_id, role } = parsed.data;

    // Role must match scope; operator accounts must name an existing operator.
    const allowed = scope === "provider" ? PROVIDER_ROLES : OPERATOR_ROLES;
    if (!allowed.includes(role)) {
      return reply.code(400).send(envelope("ROLE_SCOPE_MISMATCH", `role ${role} is not valid for ${scope} scope`, req.id));
    }
    if (scope === "operator") {
      if (!operator_id) return reply.code(400).send(envelope("OPERATOR_ID_REQUIRED", "operator scope needs operator_id", req.id));
      try {
        app.container.mgmt.getOperator(operator_id);
      } catch {
        return reply.code(404).send(envelope("OPERATOR_NOT_FOUND", "no such operator", req.id));
      }
    }

    try {
      const result = app.container.adminAccounts.create(
        { username, scope, operator_id: scope === "operator" ? operator_id : null, role },
        claims.admin_id
      );
      return reply.code(201).send(result);
    } catch (err) {
      const code = err instanceof Error ? err.message : "BAD_REQUEST";
      const status = code === "DUPLICATE_USERNAME" ? 409 : 400;
      return reply.code(status).send(envelope(code, code, req.id));
    }
  });

  const withAccount = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const { id } = req.params as { id: string };
    if (!app.container.adminAccounts.getById(id)) {
      reply.code(404).send(envelope("ACCOUNT_NOT_FOUND", "no such admin account", req.id));
      return null;
    }
    return id;
  };

  app.post("/admin/v1/admin-accounts/:id/disable", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply);
    if (!claims) return reply;
    const id = withAccount(req, reply);
    if (!id) return reply;
    return { account: app.container.adminAccounts.disable(id, claims.admin_id) };
  });

  app.post("/admin/v1/admin-accounts/:id/reset-password", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply);
    if (!claims) return reply;
    const id = withAccount(req, reply);
    if (!id) return reply;
    return app.container.adminAccounts.resetPassword(id, claims.admin_id);
  });

  app.post("/admin/v1/admin-accounts/:id/reset-totp", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply);
    if (!claims) return reply;
    const id = withAccount(req, reply);
    if (!id) return reply;
    return { account: app.container.adminAccounts.resetTotp(id, claims.admin_id) };
  });
};

export default adminAccountRoutes;
