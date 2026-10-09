import type { FastifyPluginAsync } from "fastify";
import { operatorHmacAuth } from "./auth";
import { envelope, sendDomainError } from "./errors";
import type { Campaign, PlayerCampaign } from "../modules/campaigns/campaign.repository";

interface LaunchBody {
  game_code?: string;
  operator_player_id?: string;
  currency?: string;
  origin?: string;
}

interface GrantBody {
  campaign_id?: string;
  operator_player_id?: string;
}

interface CancelBody {
  campaign_id?: string;
  /** Present: cancel only this player's grant. Absent: the whole campaign. */
  operator_player_id?: string;
}

/** Wire shape of one player grant for the casino (no internal version counters). */
function grantView(grant: PlayerCampaign, campaign: Campaign, gameCode: string | null) {
  return {
    grant_id: grant.id,
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    game_code: gameCode,
    currency: campaign.currency,
    bet_amount: campaign.bet_amount, // locked bet every free round plays at
    spins_granted: grant.spins_granted,
    spins_remaining: grant.spins_remaining,
    total_won: grant.total_won,
    status: grant.status,
    valid_from: campaign.valid_from,
    valid_to: campaign.valid_to
  };
}

/**
 * Operator (server-to-server) API — HMAC-signed (src/lib/security/hmac.ts via
 * operatorHmacAuth: api key, timestamp skew, single-use nonce, signature over
 * method + path + raw body). The authenticated operator comes ONLY from the API
 * key (req.operatorId), never from the request, so a casino can act on nothing
 * but its own campaigns and players.
 */
const operatorRoutes: FastifyPluginAsync = async (app) => {
  const auth = operatorHmacAuth(app.container);
  const gameCode = (gameId: string): string | null =>
    app.container.mgmt.listGames().find((g) => g.id === gameId)?.code ?? null;

  app.post("/operator/v1/launch", { preHandler: auth }, async (req, reply) => {
    const body = (req.body ?? {}) as LaunchBody;
    if (!body.game_code || !body.operator_player_id || !body.currency || !body.origin) {
      return reply.code(422).send(envelope("VALIDATION", "game_code, operator_player_id, currency, origin required", req.id));
    }
    try {
      const launchToken = app.container.sessions.createLaunchToken({
        operator_id: req.operatorId as string,
        game_code: body.game_code,
        operator_player_id: body.operator_player_id,
        currency: body.currency,
        origin: body.origin
      });
      return { launch_token: launchToken, expires_in: 60 };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Award a campaign's free rounds to one player. Idempotent: re-sending the same
  // (campaign, player) returns the existing grant with already_granted=true and is
  // never topped up, so a casino retrying after a timeout can't double the award.
  app.post("/operator/v1/free-rounds/grant", { preHandler: auth }, async (req, reply) => {
    const operatorId = req.operatorId as string;
    const body = (req.body ?? {}) as GrantBody;
    const playerId = typeof body.operator_player_id === "string" ? body.operator_player_id.trim() : "";
    if (!body.campaign_id || !playerId) {
      return reply.code(422).send(envelope("VALIDATION", "campaign_id, operator_player_id required", req.id));
    }
    const campaign = app.container.campaigns.getCampaign(body.campaign_id);
    // Another operator's campaign is indistinguishable from a missing one.
    if (!campaign || campaign.operator_id !== operatorId) {
      return reply.code(404).send(envelope("CAMPAIGN_NOT_FOUND", "no such campaign", req.id));
    }
    try {
      const res = app.container.campaigns.grantPlayers(campaign.id, [playerId]);
      const grant = res.granted[0] ?? app.container.campaigns.listGrants(campaign.id).find((g) => g.operator_player_id === playerId);
      if (!grant) throw new Error("GRANT_NOT_FOUND");
      if (res.granted.length) {
        app.container.auditRepo.append({
          operator_id: operatorId,
          actor_type: "operator",
          actor_id: req.apiKeyId as string,
          action: "campaign.grant",
          target_type: "campaign",
          target_id: campaign.id
        });
      }
      return reply
        .code(res.granted.length ? 201 : 200)
        .send({ already_granted: res.granted.length === 0, grant: grantView(grant, campaign, gameCode(campaign.game_id)) });
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Withdraw free rounds: the whole campaign, or one player's grant when
  // operator_player_id is given. Idempotent (a repeat reports already_cancelled and
  // changes nothing). Rounds already played stand; a feature a free round triggered
  // still plays out. Another operator's campaign is indistinguishable from a missing one.
  app.post("/operator/v1/free-rounds/cancel", { preHandler: auth }, async (req, reply) => {
    const operatorId = req.operatorId as string;
    const body = (req.body ?? {}) as CancelBody;
    if (!body.campaign_id || typeof body.campaign_id !== "string") {
      return reply.code(422).send(envelope("VALIDATION", "campaign_id required", req.id));
    }
    if (body.operator_player_id !== undefined && (typeof body.operator_player_id !== "string" || !body.operator_player_id.trim())) {
      return reply.code(422).send(envelope("VALIDATION", "operator_player_id must be a non-empty string", req.id));
    }
    const campaign = app.container.campaigns.getCampaign(body.campaign_id);
    if (!campaign || campaign.operator_id !== operatorId) {
      return reply.code(404).send(envelope("CAMPAIGN_NOT_FOUND", "no such campaign", req.id));
    }
    const auditCancel = (action: string, targetType: string, targetId: string) =>
      app.container.auditRepo.append({
        operator_id: operatorId,
        actor_type: "operator",
        actor_id: req.apiKeyId as string,
        action,
        target_type: targetType,
        target_id: targetId
      });
    try {
      if (body.operator_player_id !== undefined) {
        const playerId = body.operator_player_id.trim();
        const res = app.container.campaigns.cancelGrant(campaign.id, playerId);
        if (res.cancelled) auditCancel("campaign.grant.cancel", "player_campaign", res.grant.id);
        return {
          scope: "player",
          already_cancelled: !res.cancelled && res.grant.status === "cancelled",
          cancelled: res.cancelled,
          grant: grantView(res.grant, campaign, gameCode(campaign.game_id))
        };
      }
      const res = app.container.campaigns.cancelCampaign(campaign.id);
      const changed = campaign.status !== "cancelled";
      if (changed) auditCancel("campaign.cancel", "campaign", campaign.id);
      return {
        scope: "campaign",
        already_cancelled: !changed,
        cancelled: changed,
        campaign_id: campaign.id,
        status: res.campaign.status,
        grants_cancelled: res.grants_cancelled
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Signed round-history export for a dispute (src/modules/rounds/round-export.service.ts).
  // Only the round's own operator gets it; anything else is indistinguishable from a
  // missing round.
  app.get("/operator/v1/rounds/:roundRef/export", { preHandler: auth }, async (req, reply) => {
    const { roundRef } = req.params as { roundRef: string };
    const out = app.container.roundExport.export(roundRef, req.operatorId as string);
    if (!out) return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    app.container.auditRepo.append({
      operator_id: req.operatorId as string,
      actor_type: "operator",
      actor_id: req.apiKeyId as string,
      action: "round.export",
      target_type: "round",
      target_id: roundRef
    });
    return out;
  });

  // Every public key that ever signed (exports and ledger rows): the active one first,
  // then the retired ones, each identified by the key_id its signatures carry. Public
  // by design; no auth. Retired keys stay listed forever, or old signatures could no
  // longer be checked.
  app.get("/.well-known/round-export-keys", async () => {
    const ring = app.container.signingKeyring;
    return { active_key_id: ring.activeKeyId, keys: ring.publicKeys() };
  });

  // A player's open free rounds with this operator (active grants, soonest expiry first).
  app.get("/operator/v1/free-rounds/player/:operatorPlayerId", { preHandler: auth }, async (req) => {
    const { operatorPlayerId } = req.params as { operatorPlayerId: string };
    const grants = app.container.campaigns
      .playerGrants(req.operatorId as string, operatorPlayerId)
      .map(({ grant, campaign }) => grantView(grant, campaign, gameCode(campaign.game_id)));
    return { operator_player_id: operatorPlayerId, grants, count: grants.length };
  });
};

export default operatorRoutes;
