import { describe, it, expect } from "vitest";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { InMemoryCampaignRepository } from "../src/modules/campaigns/campaign.repository";
import { startCampaignExpiry } from "../src/jobs/campaign-expiry";
import type { Persistence } from "../src/persistence/persistence";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };
const silent = createLogger({ level: "silent", pretty: false, env: "test" }) as FastifyBaseLogger;

function provision(): { c: Container; opId: string } {
  const c = buildContainer(CONFIG, { wallet: new SandboxWallet() });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.1.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  return { c, opId: op.id };
}

const campaignInput = (operatorId: string, validTo: string) => ({
  operator_id: operatorId, game_id: "g", name: "Promo", currency: "GEL", bet_amount: 1, total_spins: 5,
  valid_from: new Date(Date.now() - 1000).toISOString(), valid_to: validTo, created_by: "t"
});

describe("campaign expiry job", () => {
  it("expires grants whose window has ended, flushes them, and leaves live grants alone", async () => {
    const saved: string[] = [];
    let flushes = 0;
    const persistence: Persistence = { save: (t) => void saved.push(t), flush: async () => void (flushes += 1), loadTable: async () => [] };
    const repo = new InMemoryCampaignRepository(persistence);
    const soon = repo.createCampaign(campaignInput("op", new Date(Date.now() + 60_000).toISOString()));
    const later = repo.createCampaign(campaignInput("op", new Date(Date.now() + 3_600_000).toISOString()));
    repo.grantPlayers(soon.id, ["p1", "p2"]);
    repo.grantPlayers(later.id, ["p1"]);

    let clock = new Date().toISOString();
    const job = startCampaignExpiry({ campaigns: repo, persistence, logger: silent, intervalMs: 0, now: () => clock });
    await new Promise((r) => setTimeout(r, 0)); // let the start-up sweep settle
    expect(repo.listGrants(soon.id).every((g) => g.status === "active")).toBe(true); // nothing due yet

    clock = new Date(Date.now() + 120_000).toISOString(); // past `soon`, before `later`
    flushes = 0;
    expect(await job.runOnce()).toBe(2);
    expect(repo.listGrants(soon.id).map((g) => g.status)).toEqual(["expired", "expired"]);
    expect(repo.listGrants(later.id)[0].status).toBe("active");
    expect(flushes).toBe(1); // outside a request, the sweep flushes its own writes
    expect(await job.runOnce()).toBe(0); // idempotent
    job.stop();
  });

  it("the app runs a start-up sweep when it becomes ready", async () => {
    const { c, opId } = provision();
    const cmp = c.campaigns.createCampaign(campaignInput(opId, new Date(Date.now() + 40).toISOString()));
    c.campaigns.grantPlayers(cmp.id, ["late-player"]);
    await new Promise((r) => setTimeout(r, 80)); // the window lapses with nobody playing

    const app: FastifyInstance = buildApp({ logger: silent, container: c, campaignExpiryIntervalMs: 0 });
    await app.ready();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.campaigns.listGrants(cmp.id)[0].status).toBe("expired");
    await app.close();
  });
});

describe("Campaign Manager API support", () => {
  async function appFor() {
    const { c, opId } = provision();
    const app = buildApp({ logger: silent, container: c, campaignExpiryIntervalMs: 0 });
    await app.ready();
    const token = (role: "operator_admin" | "operator_viewer") =>
      c.adminAuth.mintToken({ admin_id: "a", scope: "operator", operator_id: opId, role });
    return { app, c, opId, token };
  }

  it("/admin/v1/me exposes effective permissions for the UI", async () => {
    const { app, token } = await appFor();
    const admin = (await app.inject({ url: "/admin/v1/me", headers: { authorization: `Bearer ${token("operator_admin")}` } })).json() as { permissions: string[] };
    const viewer = (await app.inject({ url: "/admin/v1/me", headers: { authorization: `Bearer ${token("operator_viewer")}` } })).json() as { permissions: string[] };
    expect(admin.permissions).toContain("campaigns.write");
    expect(viewer.permissions).toContain("campaigns.read");
    expect(viewer.permissions).not.toContain("campaigns.write");
    await app.close();
  });

  it("operator games carry their game code; campaigns carry game code and a server-side state", async () => {
    const { app, token } = await appFor();
    const auth = { authorization: `Bearer ${token("operator_admin")}` };
    const games = (await app.inject({ url: "/admin/v1/operator-games", headers: auth })).json() as { operator_games: Array<{ game_code: string; game_title: string; allowed_bets: number[] }> };
    expect(games.operator_games[0]).toMatchObject({ game_code: "bananax", game_title: "Vault 20K", allowed_bets: [1, 5] });

    const in1h = new Date(Date.now() + 3_600_000).toISOString();
    const in2h = new Date(Date.now() + 7_200_000).toISOString();
    const mk = (body: object) => app.inject({ method: "POST", url: "/admin/v1/campaigns", headers: auth, payload: { game_code: "bananax", currency: "GEL", total_spins: 3, name: "x", ...body } });
    expect((await mk({ bet_amount: 2, valid_to: in1h })).statusCode).toBe(422); // not an allowed bet
    const active = (await mk({ bet_amount: 5, valid_to: in1h })).json() as { campaign: { id: string; state: string; game_code: string } };
    expect(active.campaign).toMatchObject({ state: "active", game_code: "bananax" });
    const scheduled = (await mk({ bet_amount: 1, valid_from: in1h, valid_to: in2h })).json() as { campaign: { id: string; state: string } };
    expect(scheduled.campaign.state).toBe("scheduled");

    await app.inject({ method: "POST", url: `/admin/v1/campaigns/${active.campaign.id}/cancel`, headers: auth, payload: {} });
    const list = (await app.inject({ url: "/admin/v1/campaigns", headers: auth })).json() as { campaigns: Array<{ id: string; state: string }> };
    expect(Object.fromEntries(list.campaigns.map((x) => [x.id, x.state]))).toEqual({ [active.campaign.id]: "cancelled", [scheduled.campaign.id]: "scheduled" });

    // A viewer can read but not write.
    const viewerAuth = { authorization: `Bearer ${token("operator_viewer")}` };
    expect((await app.inject({ url: "/admin/v1/campaigns", headers: viewerAuth })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/admin/v1/campaigns/${scheduled.campaign.id}/cancel`, headers: viewerAuth, payload: {} })).statusCode).toBe(403);
    await app.close();
  });
});
