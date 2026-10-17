import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { WebhookWallet } from "../src/modules/wallet/webhook-wallet";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/** A seamless-wallet casino in memory; `withBalanceAfter: false` = one that leaves it out. */
function fakeCasino(withBalanceAfter: boolean) {
  let balance = 1_000;
  const calls: Array<{ action: string; roundRef?: string }> = [];
  const fetchImpl = (async (url: URL, init: { body: string }) => {
    const action = url.pathname.split("/").pop() as string;
    const body = JSON.parse(init.body);
    calls.push({ action, roundRef: body.roundRef });
    if (action === "balance") return new Response(JSON.stringify({ amount: balance, currency: "GEL" }), { status: 200 });
    balance += action === "credit" ? body.amount : -body.amount;
    balance = Math.round(balance * 100) / 100;
    return new Response(JSON.stringify({ operatorTxRef: randomUUID(), status: "confirmed", ...(withBalanceAfter ? { balanceAfter: { amount: balance, currency: "GEL" } } : {}) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, balance: () => balance };
}

async function play(withBalanceAfter: boolean, spins: number) {
  const casino = fakeCasino(withBalanceAfter);
  const c = buildContainer(CONFIG, { walletFactory: (m) => new WebhookWallet(m, { fetchImpl: casino.fetchImpl }) });
  const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "C", slug: "c" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.setWebhook(op.id, "https://casino.example.com/wallet");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
  const lt = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const tok = (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token;
  casino.calls.length = 0; // session init asks for the starting balance; count the spins' calls
  const rounds: Array<{ ref: string; win: number; free: boolean; balance: number }> = [];
  for (let i = 0; i < spins; i++) {
    const res = await app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "idempotency-key": randomUUID() }, payload: '{"bet_amount":1}' });
    expect(res.statusCode, res.body).toBe(200);
    const j = res.json();
    rounds.push({ ref: j.round_ref, win: Number(j.total_win), free: Boolean(j.is_free_spin), balance: Number(j.balance?.amount ?? j.balance) });
  }
  await app.close();
  return { casino, rounds };
}

describe("casino calls per round", () => {
  it("the balance comes from the round's last money move: no extra balance call, and it is the casino's own figure", async () => {
    const { casino, rounds } = await play(true, 60);
    const roundCalls = casino.calls.filter((x) => x.action !== "balance" || x.roundRef);
    for (const r of rounds.filter((x) => !x.free)) {
      const calls = roundCalls.filter((x) => x.roundRef === r.ref).map((x) => x.action);
      expect(calls).toEqual(r.win > 0 ? ["debit", "credit"] : ["debit"]);
    }
    expect(rounds.some((r) => r.win > 0) && rounds.some((r) => r.win === 0)).toBe(true);
    // Paid rounds: the reported balance is the casino's balance after that round.
    expect(rounds.at(-1)!.free ? true : rounds.at(-1)!.balance === casino.balance()).toBe(true);
    // Only rounds with no money move at all may still ask (a feature's free spin with no win).
    expect(casino.calls.filter((x) => x.action === "balance").length).toBe(rounds.filter((r) => r.free && r.win === 0).length);
  });

  it("a casino that leaves balanceAfter out is asked once per round, as before", async () => {
    const { casino, rounds } = await play(false, 20);
    expect(casino.calls.filter((x) => x.action === "balance").length).toBe(rounds.length);
    expect(rounds.at(-1)!.balance).toBe(casino.balance());
  });
});
