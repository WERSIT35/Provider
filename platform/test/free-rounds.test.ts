import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { WebhookWallet } from "../src/modules/wallet/webhook-wallet";
import type { CreditArgs, DebitArgs, WalletAdapter } from "../src/modules/wallet/wallet.types";
import { InMemoryRoundRepository } from "../src/modules/ledger/memory-repositories";
import { PostgresPersistence, type Persistence } from "../src/persistence/persistence";
import type { ManagementService } from "../src/modules/management/management.service";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };
const IN_A_WEEK = () => new Date(Date.now() + 7 * 864e5).toISOString();

let app: FastifyInstance;
let c: Container;
let wallet: SandboxWallet;
let opA: string;
let opB: string;

/** Wallet wrapper whose debit/credit can be made to fail for chosen calls. */
class FlakyWallet implements WalletAdapter {
  failDebit: (a: DebitArgs) => boolean = () => false;
  failCredit: (a: CreditArgs) => boolean = () => false;
  constructor(private readonly inner: SandboxWallet) {}
  balance = (ctx: Parameters<WalletAdapter["balance"]>[0], a: Parameters<WalletAdapter["balance"]>[1]) => this.inner.balance(ctx, a);
  rollback = (ctx: Parameters<WalletAdapter["rollback"]>[0], a: Parameters<WalletAdapter["rollback"]>[1]) => this.inner.rollback(ctx, a);
  async debit(ctx: Parameters<WalletAdapter["debit"]>[0], a: DebitArgs) {
    if (this.failDebit(a)) throw new Error("WEBHOOK_CALL_FAILED");
    return this.inner.debit(ctx, a);
  }
  async credit(ctx: Parameters<WalletAdapter["credit"]>[0], a: CreditArgs) {
    if (this.failCredit(a)) throw new Error("WALLET_CREDIT_FAILED");
    return this.inner.credit(ctx, a);
  }
}

async function setup(opts: { walletAdapter?: (w: SandboxWallet) => WalletAdapter; persistence?: Persistence } = {}) {
  wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet: opts.walletAdapter ? opts.walletAdapter(wallet) : wallet, persistence: opts.persistence });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  for (const slug of ["a", "b"]) {
    const op = c.mgmt.createOperator({ name: slug.toUpperCase(), slug });
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 500] });
    if (slug === "a") opA = op.id;
    else opB = op.id;
  }
}

const opToken = (operatorId: string, role: "operator_admin" | "operator_viewer" = "operator_admin") =>
  c.adminAuth.mintToken({ admin_id: `adm-${operatorId.slice(0, 4)}`, scope: "operator", operator_id: operatorId, role });
const providerToken = () => c.adminAuth.mintToken({ admin_id: "prov", scope: "provider", role: "provider_super_admin" });

async function admin(method: "GET" | "POST", url: string, token: string, payload?: object) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
}

async function createCampaign(spins: number, bet = 5, operatorId = opA): Promise<string> {
  const res = await admin("POST", "/admin/v1/campaigns", opToken(operatorId), {
    game_code: "bananax", name: "Welcome", currency: "GEL", bet_amount: bet, total_spins: spins, valid_to: IN_A_WEEK()
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { campaign: { id: string } }).campaign.id;
}

function openSession(player: string, operatorId = opA) {
  const token = c.sessions.createLaunchToken({ operator_id: operatorId, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" });
  return c.sessions.initSession(token);
}

let keySeq = 0;
const spin = (sessionId: string, bet = 1) => c.orchestrator.spin(sessionId, { bet_amount: bet, idempotency_key: `k${keySeq++}` });

describe("free rounds — admin endpoints", () => {
  beforeEach(() => setup());

  it("creates a campaign only with a bet the operator's assignment offers", async () => {
    const t = opToken(opA);
    const base = { game_code: "bananax", name: "W", currency: "GEL", total_spins: 10, valid_to: IN_A_WEEK() };
    expect((await admin("POST", "/admin/v1/campaigns", t, { ...base, bet_amount: 2 })).statusCode).toBe(422);
    expect((await admin("POST", "/admin/v1/campaigns", t, { ...base, bet_amount: 5, currency: "EUR" })).statusCode).toBe(404);
    expect((await admin("POST", "/admin/v1/campaigns", t, { ...base, bet_amount: 5, total_spins: 0 })).statusCode).toBe(400);
    expect((await admin("POST", "/admin/v1/campaigns", providerToken(), { ...base, bet_amount: 5 })).statusCode).toBe(422); // must name operator
    expect((await admin("POST", "/admin/v1/campaigns", providerToken(), { ...base, bet_amount: 5, operator_id: opB })).statusCode).toBe(201);
    expect((await admin("POST", "/admin/v1/campaigns", opToken(opA, "operator_viewer"), { ...base, bet_amount: 5 })).statusCode).toBe(403);
  });

  it("isolates tenants: an operator can't see, grant or cancel another operator's campaign", async () => {
    const id = await createCampaign(3);
    const other = opToken(opB);
    expect((await admin("GET", `/admin/v1/campaigns/${id}`, other)).statusCode).toBe(404);
    expect((await admin("POST", `/admin/v1/campaigns/${id}/players`, other, { player_ids: ["p1"] })).statusCode).toBe(404);
    expect((await admin("POST", `/admin/v1/campaigns/${id}/cancel`, other)).statusCode).toBe(404);
    expect(((await admin("GET", "/admin/v1/campaigns", other)).json() as { count: number }).count).toBe(0);
    // Even passing operator_id can't widen an operator's scope.
    expect(((await admin("GET", `/admin/v1/campaigns?operator_id=${opA}`, other)).json() as { count: number }).count).toBe(0);
  });

  it("bulk-assigns players idempotently and audits it", async () => {
    const id = await createCampaign(3);
    const t = opToken(opA);
    const first = (await admin("POST", `/admin/v1/campaigns/${id}/players`, t, { player_ids: ["p1", "p2"] })).json() as { granted: number; skipped: string[] };
    expect(first).toMatchObject({ granted: 2, skipped: [] });
    const again = (await admin("POST", `/admin/v1/campaigns/${id}/players`, t, { player_ids: ["p2", "p3"] })).json() as { granted: number; skipped: string[] };
    expect(again).toMatchObject({ granted: 1, skipped: ["p2"] });
    expect((await admin("POST", `/admin/v1/campaigns/${id}/players`, t, { player_ids: [] })).statusCode).toBe(422);

    const detail = (await admin("GET", `/admin/v1/campaigns/${id}`, t)).json() as { campaign: { players: number; spins_remaining: number } };
    expect(detail.campaign).toMatchObject({ players: 3, spins_remaining: 9 });
    const actions = c.auditRepo.list({ operator_id: opA }).map((a) => a.action);
    expect(actions).toContain("campaign.create");
    expect(actions).toContain("campaign.grant");
  });
});

describe("free rounds — spin path", () => {
  beforeEach(() => setup());

  it("plays the free rounds at the locked bet, then the very next spin charges real balance", async () => {
    const id = await createCampaign(2, 5);
    await admin("POST", `/admin/v1/campaigns/${id}/players`, opToken(opA), { player_ids: ["p1"] });
    wallet.setBalance("p1", "GEL", 100);
    const session = openSession("p1");

    let balance = 100;
    let campaignWins = 0;
    for (let i = 0; i < 2; i += 1) {
      const out = await spin(session.id, 1); // client asks for 1; the campaign locks 5
      expect(out.free_round).toMatchObject({ campaign_id: id, bet_amount: 5, spins_remaining: 1 - i });
      expect(out.bet_charged).toBe(0);
      expect(c.ledger.getRound(out.round_ref)).toMatchObject({ bet_amount: 5, bet_charged: 0, campaign_id: id });
      balance = Number((balance + out.total_win).toFixed(2));
      expect(out.balance.amount).toBe(balance); // player never paid for it
      campaignWins += out.total_win;
    }
    // If a free round happened to trigger the engine's scatter feature, those spins
    // are the engine's own free spins: still free, no campaign spin is used, and
    // their wins belong to the campaign that triggered them.
    while (c.sessions.get(session.id).free_spins_left > 0) {
      const fs = await spin(session.id, 1);
      expect(fs.free_round).toBeNull();
      expect(fs.bet_charged).toBe(0);
      balance = Number((balance + fs.total_win).toFixed(2));
      campaignWins += fs.total_win;
    }

    const paid = await spin(session.id, 1);
    expect(paid.free_round).toBeNull();
    expect(paid.bet_charged).toBe(1);
    expect(paid.balance.amount).toBe(Number((balance - 1 + paid.total_win).toFixed(2)));
    const paidTx = c.transactions.list({ round_ref: paid.round_ref });
    expect(paidTx.find((t) => t.type === "DEBIT")).toMatchObject({ amount: 1, status: "confirmed" });
    expect(paidTx.some((t) => t.campaign_id)).toBe(false);

    const grant = c.campaigns.listGrants(id)[0];
    expect(grant).toMatchObject({ spins_remaining: 0, status: "exhausted" });
    expect(grant.total_won).toBeCloseTo(campaignWins, 2);
  });

  it("tags the money ledger: FREE_ROUND_BET 0.00 and FREE_ROUND_WIN, both with campaign_id", async () => {
    const id = await createCampaign(30, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    wallet.setBalance("p1", "GEL", 0);
    const session = openSession("p1");

    const refs: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      if (c.sessions.get(session.id).free_spins_left > 0) break; // stay on campaign spins only
      refs.push((await spin(session.id)).round_ref);
    }
    const txs = refs.flatMap((r) => c.transactions.list({ round_ref: r }));
    const bets = txs.filter((t) => t.type === "FREE_ROUND_BET");
    expect(bets).toHaveLength(refs.length);
    expect(bets.every((t) => t.amount === 0 && t.campaign_id === id)).toBe(true);
    expect(txs.some((t) => t.type === "DEBIT" || t.type === "CREDIT")).toBe(false);
    const wins = txs.filter((t) => t.type === "FREE_ROUND_WIN");
    expect(wins.every((t) => t.campaign_id === id && t.amount > 0)).toBe(true);
    // Reconciliation treats them as the rounds' stake and win.
    expect(c.reporting.reconcile(opA).ok).toBe(true);
  });

  it("a zero-balance player can play free rounds, then is declined for cash", async () => {
    const id = await createCampaign(1, 5);
    c.campaigns.grantPlayers(id, ["broke"]);
    wallet.setBalance("broke", "GEL", 0);
    const session = openSession("broke");
    const out = await spin(session.id);
    expect(out.free_round?.campaign_id).toBe(id);
    expect(out.bet_charged).toBe(0);
    while (c.sessions.get(session.id).free_spins_left > 0) await spin(session.id);
    // Whatever the free round paid out, an empty wallet must now decline cash play.
    wallet.setBalance("broke", "GEL", 0);
    await expect(spin(session.id)).rejects.toThrow("INSUFFICIENT_FUNDS");
    expect(c.campaigns.listGrants(id)[0]).toMatchObject({ spins_remaining: 0, status: "exhausted" });
  });

  it("only uses grants for the same operator: another casino's p1 pays cash", async () => {
    const id = await createCampaign(5, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    wallet.setBalance("p1", "GEL", 100);
    const out = await spin(openSession("p1", opB).id);
    expect(out.free_round).toBeNull();
    expect(out.bet_charged).toBe(1);
  });

  it("session/init lists waiting free rounds and /spin returns free_round", async () => {
    const id = await createCampaign(3, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    wallet.setBalance("p1", "GEL", 100);
    const lt = c.sessions.createLaunchToken({ operator_id: opA, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
    const init = (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json() as {
      session_token: string;
      free_rounds: Array<{ campaign_id: string; bet_amount: number; spins_remaining: number }>;
    };
    expect(init.free_rounds).toEqual([expect.objectContaining({ campaign_id: id, bet_amount: 5, spins_remaining: 3 })]);
    const res = await app.inject({
      method: "POST", url: "/game/v1/spin",
      headers: { authorization: `Bearer ${init.session_token}`, "idempotency-key": "http-1" },
      payload: { bet_amount: 1 }
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { free_round: { campaign_id: string; spins_remaining: number } }).free_round).toMatchObject({ campaign_id: id, spins_remaining: 2 });
  });

  it("a duplicate in-flight request can't burn a second free round", async () => {
    const id = await createCampaign(5, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    const session = openSession("p1");
    const [a, b] = await Promise.allSettled([
      c.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "dup" }),
      c.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "dup" })
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status === "rejected" && (b.reason as Error).message).toBe("REQUEST_IN_PROGRESS");
    expect(c.campaigns.listGrants(id)[0].spins_remaining).toBe(4);
    // A later retry replays the stored outcome without consuming.
    expect((await c.orchestrator.spin(session.id, { bet_amount: 1, idempotency_key: "dup" })).idempotent_replay).toBe(true);
    expect(c.campaigns.listGrants(id)[0].spins_remaining).toBe(4);
  });
});

describe("free rounds — failures and lifecycle", () => {
  it("hands the free round back when the casino rejects the FREE_ROUND_BET", async () => {
    let flaky!: FlakyWallet;
    await setup({ walletAdapter: (w) => (flaky = new FlakyWallet(w)) });
    const id = await createCampaign(2, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    const session = openSession("p1");
    flaky.failDebit = (a) => a.txType === "FREE_ROUND_BET";
    await expect(spin(session.id)).rejects.toThrow("WEBHOOK_CALL_FAILED");
    expect(c.campaigns.listGrants(id)[0]).toMatchObject({ spins_remaining: 2, status: "active" });
  });

  it("a failed FREE_ROUND_WIN lands in the settlement queue and settles re-tagged", async () => {
    let flaky!: FlakyWallet;
    await setup({ walletAdapter: (w) => (flaky = new FlakyWallet(w)) });
    const id = await createCampaign(200, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    const session = openSession("p1");
    flaky.failCredit = (a) => a.txType === "FREE_ROUND_WIN";

    let won: string | null = null;
    for (let i = 0; i < 200 && !won; i += 1) {
      if (c.sessions.get(session.id).free_spins_left > 0) break;
      const out = await spin(session.id);
      if (out.total_win > 0) {
        expect(out.settlement).toBe("credit_pending");
        won = out.round_ref;
      }
    }
    expect(won).not.toBeNull();
    expect(c.reporting.failedSettlements(opA).map((t) => t.round_ref)).toContain(won);

    flaky.failCredit = () => false;
    await c.lifecycle.settleRound(won!, "ops", "retry");
    const paid = c.transactions.list({ round_ref: won! }).find((t) => t.status === "confirmed" && t.type === "FREE_ROUND_WIN");
    expect(paid?.campaign_id).toBe(id);
    expect(c.reporting.failedSettlements(opA)).toHaveLength(0);
  });

  it("voiding a free round refunds nothing and claws back the win", async () => {
    await setup();
    const id = await createCampaign(200, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    const session = openSession("p1");
    let won: string | null = null;
    for (let i = 0; i < 200 && !won; i += 1) {
      if (c.sessions.get(session.id).free_spins_left > 0) break;
      const out = await spin(session.id);
      if (out.total_win > 0) won = out.round_ref;
    }
    expect(won).not.toBeNull();
    const res = await c.lifecycle.voidRound(won!, "ops", "test");
    const txs = c.transactions.list({ round_ref: won! });
    expect(txs.some((t) => t.type === "ROLLBACK")).toBe(false);
    expect(txs.find((t) => t.type === "ADJUSTMENT")?.status).toBe("confirmed");
    expect(res.notes.join(" ")).toMatch(/clawed back/);
  });
});

describe("free rounds — wallet + ledger integrity", () => {
  it("the webhook body carries txType + campaignId; a non-zero free bet never leaves the RGS", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: URL, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ operatorTxRef: "x", status: "confirmed" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mgmt = { getWebhookConfig: () => ({ url: "https://casino.test/wallet" }), getWebhookSecret: () => "sec" } as unknown as ManagementService;
    const w = new WebhookWallet(mgmt, { fetchImpl });
    const base = { idempotencyKey: "i", roundRef: "r", operatorPlayerId: "p1", currency: "GEL" };
    await w.debit({ operatorId: "op" }, { ...base, amount: 0, txType: "FREE_ROUND_BET", campaignId: "cmp_1" });
    await w.credit({ operatorId: "op" }, { ...base, amount: 7.5, txType: "FREE_ROUND_WIN", campaignId: "cmp_1" });
    await w.debit({ operatorId: "op" }, { ...base, amount: 1 });
    expect(bodies[0]).toMatchObject({ amount: 0, txType: "FREE_ROUND_BET", campaignId: "cmp_1" });
    expect(bodies[1]).toMatchObject({ amount: 7.5, txType: "FREE_ROUND_WIN", campaignId: "cmp_1" });
    expect(bodies[2]).not.toHaveProperty("txType"); // cash payload unchanged

    await expect(w.debit({ operatorId: "op" }, { ...base, amount: 5, txType: "FREE_ROUND_BET", campaignId: "cmp_1" })).rejects.toThrow("FREE_ROUND_BET_MUST_BE_ZERO");
    await expect(w.credit({ operatorId: "op" }, { ...base, amount: 5, txType: "FREE_ROUND_WIN" })).rejects.toThrow("FREE_ROUND_CAMPAIGN_REQUIRED");
    expect(bodies).toHaveLength(3);
  });

  it("the round hash chain survives a Postgres round-trip with mixed cash + free rounds", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const recorder: Persistence = {
      save: (table, row) => void (table === "rounds" && saved.push({ ...(row as Record<string, unknown>) })),
      flush: async () => {},
      loadTable: async () => []
    };
    await setup({ persistence: recorder });
    const id = await createCampaign(3, 5);
    c.campaigns.grantPlayers(id, ["p1"]);
    wallet.setBalance("p1", "GEL", 100);
    const session = openSession("p1");
    for (let i = 0; i < 6; i += 1) await spin(session.id);
    // A free round can trigger the bonus, whose spins stay campaign-tagged; play on
    // until the feature ends and a cash round is recorded.
    for (let i = 0; i < 300 && !saved.some((r) => !("campaign_id" in r)); i += 1) await spin(session.id);
    expect(saved.some((r) => r.campaign_id)).toBe(true);
    expect(saved.some((r) => !("campaign_id" in r))).toBe(true);

    // Simulate Postgres: every column comes back, NULL where the app never wrote one.
    const pg = new PostgresPersistence({
      query: async () => ({
        rows: saved.map((r) => {
          const row: Record<string, unknown> = { ...r, outcome_jsonb: r.outcome };
          for (const col of ["campaign_id", "grant_id", "pre_state"]) if (row[col] === undefined) row[col] = null;
          return row;
        })
      })
    } as unknown as Pool);
    const reborn = new InMemoryRoundRepository();
    reborn.hydrate((await pg.loadTable("rounds")) as never);
    expect(reborn.verifyChain()).toMatchObject({ ok: true, length: saved.length });
  });
});
