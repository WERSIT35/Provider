import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { envelope, sendDomainError } from "./errors";
import { adminAuthPreHandler } from "./admin.routes";
import { can, resolveOperatorScope, type AdminClaims } from "../modules/admin/admin-auth";
import type { Campaign, PlayerCampaign } from "../modules/campaigns/campaign.repository";

/**
 * Campaign Manager — operator-granted Free Rounds (Admin API).
 *
 * Tenant isolation: an operator admin is pinned to its own operator_id; a campaign
 * belonging to another operator answers 404 (existence is never leaked), so an
 * operator can only ever grant spins to ITS OWN players. Provider admins must name
 * the operator explicitly when creating.
 */
interface CreateBody {
  operator_id?: string;
  game_code?: string;
  name?: string;
  currency?: string;
  bet_amount?: number;
  total_spins?: number;
  valid_from?: string;
  valid_to?: string;
}

function summarize(c: Campaign, grants: PlayerCampaign[]) {
  return {
    ...c,
    players: grants.length,
    spins_granted: grants.reduce((s, g) => s + g.spins_granted, 0),
    spins_remaining: grants.filter((g) => g.status === "active").reduce((s, g) => s + g.spins_remaining, 0),
    total_won: Number(grants.reduce((s, g) => s + g.total_won, 0).toFixed(2))
  };
}

const adminCampaignRoutes: FastifyPluginAsync = async (app) => {
  const auth = adminAuthPreHandler(app.container);
  const repo = app.container.campaigns;

  const guard = (req: FastifyRequest, reply: FastifyReply, permission: string): AdminClaims | null => {
    const claims = req.adminClaims as AdminClaims;
    if (!can(claims, permission)) {
      reply.code(403).send(envelope("FORBIDDEN", `missing permission: ${permission}`, req.id));
      return null;
    }
    return claims;
  };

  /** The campaign, if this admin may see it; otherwise a 404 has been sent. */
  const loadOwned = (req: FastifyRequest, reply: FastifyReply, claims: AdminClaims): Campaign | null => {
    const { id } = req.params as { id: string };
    const c = repo.getCampaign(id);
    if (!c || (claims.scope === "operator" && claims.operator_id !== c.operator_id)) {
      reply.code(404).send(envelope("CAMPAIGN_NOT_FOUND", "no such campaign", req.id));
      return null;
    }
    return c;
  };

  const audit = (claims: AdminClaims, operatorId: string, action: string, campaignId: string) =>
    app.container.auditRepo.append({
      operator_id: operatorId,
      actor_type: "admin",
      actor_id: claims.admin_id,
      action,
      target_type: "campaign",
      target_id: campaignId
    });

  app.get("/admin/v1/campaigns", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    const campaigns = repo
      .listCampaigns(resolveOperatorScope(claims, q.operator_id))
      .map((c) => summarize(c, repo.listGrants(c.id)));
    return { campaigns, count: campaigns.length };
  });

  app.get("/admin/v1/campaigns/:id", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const c = loadOwned(req, reply, claims);
    if (!c) return reply;
    const grants = repo.listGrants(c.id);
    return { campaign: summarize(c, grants), grants };
  });

  app.post("/admin/v1/campaigns", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const body = (req.body ?? {}) as CreateBody;
    const operatorId = resolveOperatorScope(claims, body.operator_id);
    if (!operatorId) return reply.code(422).send(envelope("VALIDATION", "operator_id required", req.id));
    if (!body.game_code || !body.currency || typeof body.bet_amount !== "number" || typeof body.total_spins !== "number" || !body.valid_to) {
      return reply
        .code(422)
        .send(envelope("VALIDATION", "game_code, currency, bet_amount, total_spins, valid_to required", req.id));
    }
    // The locked bet must be one this operator's game assignment actually offers in
    // this currency: free rounds never play a stake the operator couldn't sell.
    const currency = body.currency.trim().toUpperCase();
    const og = app.container.mgmt.findOperatorGame(operatorId, body.game_code, currency);
    if (!og) return reply.code(404).send(envelope("GAME_NOT_ASSIGNED", "game not enabled for this operator/currency", req.id));
    if (!og.allowed_bets.includes(body.bet_amount)) {
      return reply.code(422).send(envelope("CAMPAIGN_BET_INVALID", `bet_amount must be one of: ${og.allowed_bets.join(", ")}`, req.id));
    }
    try {
      const campaign = repo.createCampaign({
        operator_id: operatorId,
        game_id: og.game_id,
        name: body.name ?? "",
        currency,
        bet_amount: body.bet_amount,
        total_spins: body.total_spins,
        valid_from: body.valid_from ?? new Date().toISOString(),
        valid_to: body.valid_to,
        created_by: claims.admin_id
      });
      audit(claims, operatorId, "campaign.create", campaign.id);
      return reply.code(201).send({ campaign: summarize(campaign, []) });
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Bulk-assign players. Idempotent per player (re-sends are reported as skipped,
  // never topped up) and all-or-nothing on invalid ids.
  app.post("/admin/v1/campaigns/:id/players", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const c = loadOwned(req, reply, claims);
    if (!c) return reply;
    const body = (req.body ?? {}) as { player_ids?: unknown };
    if (!Array.isArray(body.player_ids) || body.player_ids.length === 0) {
      return reply.code(422).send(envelope("VALIDATION", "player_ids (non-empty array) required", req.id));
    }
    try {
      const res = repo.grantPlayers(c.id, body.player_ids as string[]);
      if (res.granted.length) audit(claims, c.operator_id, "campaign.grant", c.id);
      return { campaign_id: c.id, granted: res.granted.length, skipped: res.skipped, grants: res.granted };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Stop the promotion: unplayed spins are withdrawn; rounds already played stand.
  app.post("/admin/v1/campaigns/:id/cancel", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const c = loadOwned(req, reply, claims);
    if (!c) return reply;
    const res = repo.cancelCampaign(c.id);
    if (res.campaign.status === "cancelled" && c.status !== "cancelled") audit(claims, c.operator_id, "campaign.cancel", c.id);
    return { campaign: summarize(res.campaign, repo.listGrants(c.id)), grants_cancelled: res.grants_cancelled };
  });
};

export default adminCampaignRoutes;
