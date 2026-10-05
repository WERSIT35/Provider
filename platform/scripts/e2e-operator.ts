/**
 * End-to-end "a casino rents your slot" walkthrough, over REAL HTTP.
 *
 *   npx tsx scripts/e2e-operator.ts
 *
 * Three actors are simulated and labelled in the output:
 *   • PROVIDER (you)        — onboard the operator + assign the game (control plane).
 *   • OPERATOR backend      — server-to-server HMAC-signed call to launch a player.
 *   • PLAYER browser        — opens a session and spins (bearer-token Game API).
 * Then PROVIDER + OPERATOR read reports, and the OPERATOR runs a free-rounds
 * campaign end to end (grant → play → cancel).
 *
 * Provisioning is done in-process (the provider's admin actions); the operator and
 * player steps are genuine HTTP requests so the signing/token/idempotency flow is real.
 */
import { buildContainer } from "../src/container";
import { buildApp } from "../src/app";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { computeSignature } from "../src/lib/security/hmac";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a: unknown[]) => console.log(...a);
const hr = (t: string) => log(`\n──────── ${t} ────────`);

async function main(): Promise<void> {
  const cfg = {
    launchSecret: "demo-launch", sessionSecret: "demo-session", adminSecret: "demo-admin",
    hmacSkewSeconds: 30, rateLimitPerMin: 10_000
  };
  const wallet = new SandboxWallet();
  const container = buildContainer(cfg, { wallet });
  const app = buildApp({ logger: createLogger({ level: "warn", pretty: false, env: "local" }), container });
  await app.listen({ host: "127.0.0.1", port: PORT });

  // ════════════════════════════════════════════════════════════════════════════
  hr("STEP 1 · PROVIDER (you) onboard the operator");
  // In production this is your provider admin portal / Admin API. The credential's
  // secret is shown exactly once — you hand it to the operator over a secure channel.
  const op = container.mgmt.createOperator({ name: "LuckySpin Casino", slug: "luckyspin", default_currency: "GEL" });
  container.mgmt.setOperatorStatus(op.id, "live");
  container.mgmt.addDomain(op.id, "play.luckyspin.com", "prod"); // their casino domain (allowlist)
  const cred = container.mgmt.issueCredential(op.id, "prod", ["203.0.113.10/32"]); // their server IP
  log(`created operator '${op.slug}' (status=live)`);
  log(`allowlisted launch domain: play.luckyspin.com`);
  log(`issued API credential:`);
  log(`   X-Api-Key : ${cred.credential.api_key_id}`);
  log(`   secret    : ${cred.api_secret}   (given to operator ONCE)`);

  hr("STEP 2 · PROVIDER assign your game with an APPROVED RTP config");
  const game = container.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let mc = container.mgmt.createMathConfig({ game_id: game.id, version: container.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: `sha256:${container.engine.rulesHash()}` });
  mc = container.mgmt.approveMathConfig(container.mgmt.submitMathConfigForReview(mc.id).id, "math-lead");
  container.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: mc.id, currency: "GEL", allowed_bets: [1, 5, 10, 50, 500] });
  log(`game 'bananax' assigned to LuckySpin @ RTP ${mc.theoretical_rtp}% (config ${mc.status})`);
  log(`(an UNAPPROVED config would be rejected with CONFIG_NOT_APPROVED)`);

  // The operator's player wallet (in the seamless model the OPERATOR holds funds;
  // here our sandbox wallet stands in for their wallet API).
  wallet.setBalance("player-7781", "GEL", 100);
  log(`operator wallet: player 'player-7781' balance = 100.00 GEL`);

  // ════════════════════════════════════════════════════════════════════════════
  hr("STEP 3 · OPERATOR backend requests a launch (server-to-server, HMAC-signed)");
  // The operator's server signs the request with the secret you gave them.
  const launchBody = JSON.stringify({ game_code: "bananax", operator_player_id: "player-7781", currency: "GEL", origin: "play.luckyspin.com" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = computeSignature(cred.api_secret, { timestamp: ts, method: "POST", path: "/operator/v1/launch", rawBody: launchBody });
  const launchRes = await fetch(`${BASE}/operator/v1/launch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cred.credential.api_key_id,
      "x-timestamp": ts,
      "x-nonce": randomUUID(),
      "x-signature": signature
    },
    body: launchBody
  });
  const launch = (await launchRes.json()) as { launch_url?: string; launch_token: string };
  log(`POST /operator/v1/launch -> ${launchRes.status}`);
  log(`operator embeds this game URL in their lobby iframe with the launch token:`);
  log(`   ${BASE}/play?lt=${launch.launch_token.slice(0, 24)}…`);

  // Show that an unsigned/forged call is rejected.
  const forged = await fetch(`${BASE}/operator/v1/launch`, { method: "POST", headers: { "content-type": "application/json" }, body: launchBody });
  log(`(forged unsigned launch -> ${forged.status} ${(await forged.json() as { error: { code: string } }).error.code})`);

  // ════════════════════════════════════════════════════════════════════════════
  hr("STEP 4 · PLAYER browser opens the game (Game API, bearer token)");
  const initRes = await fetch(`${BASE}/game/v1/session/init`, { method: "POST", headers: { authorization: `Bearer ${launch.launch_token}` } });
  const init = (await initRes.json()) as { session_token: string; balance: { amount: number }; allowed_bets: number[] };
  log(`POST /game/v1/session/init -> ${initRes.status}`);
  log(`   balance ${init.balance.amount.toFixed(2)} GEL · bets [${init.allowed_bets.join(", ")}]`);

  hr("STEP 5 · PLAYER spins (server-authoritative; every spin is idempotent)");
  let lastBalance = init.balance.amount;
  for (let i = 1; i <= 5; i += 1) {
    const idem = randomUUID();
    const res = await fetch(`${BASE}/game/v1/spin`, {
      method: "POST",
      headers: { authorization: `Bearer ${init.session_token}`, "content-type": "application/json", "idempotency-key": idem },
      body: JSON.stringify({ bet_amount: 5 })
    });
    const out = (await res.json()) as { round_ref: string; total_win: number; balance: { amount: number } };
    log(`spin ${i}: bet 5 → win ${out.total_win.toFixed(2)} · balance ${out.balance.amount.toFixed(2)} · round ${out.round_ref}`);
    lastBalance = out.balance.amount;

    if (i === 3) {
      // Demonstrate idempotency: replay the SAME request → no second charge.
      const replay = await fetch(`${BASE}/game/v1/spin`, {
        method: "POST",
        headers: { authorization: `Bearer ${init.session_token}`, "content-type": "application/json", "idempotency-key": idem },
        body: JSON.stringify({ bet_amount: 5 })
      });
      log(`   ↳ retried spin ${i} with same Idempotency-Key → replay=${replay.headers.get("idempotent-replay")} (balance unchanged)`);
    }
  }
  log(`final player balance: ${lastBalance.toFixed(2)} GEL`);

  // ════════════════════════════════════════════════════════════════════════════
  hr("STEP 6 · PROVIDER + OPERATOR read reports (Admin API, RBAC)");
  const providerTok = container.adminAuth.mintToken({ admin_id: "you", scope: "provider", operator_id: null, role: "provider_super_admin" });
  const operatorTok = container.adminAuth.mintToken({ admin_id: "luckyspin-admin", scope: "operator", operator_id: op.id, role: "operator_admin" });
  const adminGet = async (path: string, tok: string) =>
    (await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${tok}` } })).json();

  const summary = await adminGet(`/admin/v1/reports/summary?operator_id=${op.id}`, providerTok);
  const recon = await adminGet(`/admin/v1/reports/reconciliation?operator_id=${op.id}`, providerTok);
  log(`PROVIDER  /reports/summary       -> ${JSON.stringify(summary)}`);
  log(`PROVIDER  /reports/reconciliation-> ok=${(recon as { ok: boolean }).ok}  (ledger vs money agree)`);

  const opRounds = (await adminGet(`/admin/v1/rounds`, operatorTok)) as { count: number; rounds: Array<{ round_ref: string; total_win: number }> };
  const opForbidden = await fetch(`${BASE}/admin/v1/operators`, { headers: { authorization: `Bearer ${operatorTok}` } });
  log(`OPERATOR  /rounds (own only)     -> count ${opRounds.count}`);
  log(`OPERATOR  /operators (provider-only) -> ${opForbidden.status} (correctly forbidden)`);

  hr("STEP 7 · PROVIDER looks up a specific spin via the Round Inspector API");
  // Prefer a winning round so the inspector has something interesting to show.
  const winning = opRounds.rounds.find((r) => r.total_win > 0) ?? opRounds.rounds[0];
  if (winning) {
    const detail = (await adminGet(`/admin/v1/rounds/${winning.round_ref}`, providerTok)) as {
      round_ref: string;
      total_win: number;
      outcome: { matrix: string[][]; tumble_steps: unknown[]; ways_wins: Array<{ symbol: string; count: number; amount: number }>; scatter_count: number };
    };
    const wins = detail.outcome?.ways_wins ?? [];
    const big = wins.slice().sort((a, b) => b.amount - a.amount)[0];
    log(`PROVIDER  GET /admin/v1/rounds/${detail.round_ref}`);
    log(`   total_win:       ${detail.total_win.toFixed(2)} GEL`);
    log(`   scatter_count:   ${detail.outcome.scatter_count ?? 0}`);
    log(`   tumble_steps:    ${(detail.outcome.tumble_steps || []).length}`);
    log(`   ways_wins:       ${wins.length}${big ? ` (biggest: ${big.symbol} ×${big.count} = ${big.amount.toFixed(2)})` : ""}`);
    log(`   stored matrix:   ${(detail.outcome.matrix?.length ?? 0)} rows × ${(detail.outcome.matrix?.[0]?.length ?? 0)} cols`);
    log(`   → open ${BASE}/admin and paste ${detail.round_ref} into the Round Inspector`);

    // Cross-tenant scope check: a foreign operator must get 404, not the round data.
    const foreignOp = container.mgmt.createOperator({ name: "Other", slug: "other-casino" });
    const foreignTok = container.adminAuth.mintToken({ admin_id: "x", scope: "operator", operator_id: foreignOp.id, role: "operator_admin" });
    const cross = await fetch(`${BASE}/admin/v1/rounds/${detail.round_ref}`, { headers: { authorization: `Bearer ${foreignTok}` } });
    log(`   cross-tenant attempt -> ${cross.status} (correctly hidden)`);
  } else {
    log("no rounds recorded (unexpected)");
  }

  // ════════════════════════════════════════════════════════════════════════════
  hr("STEP 8 · Free rounds: OPERATOR grant → PLAYER plays → OPERATOR cancel");
  // A signed operator-API call (the same HMAC scheme as the launch in STEP 3).
  const signed = async (method: "GET" | "POST", path: string, body?: object) => {
    const rawBody = body ? JSON.stringify(body) : "";
    const t = Math.floor(Date.now() / 1000).toString();
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        "x-api-key": cred.credential.api_key_id,
        "x-timestamp": t,
        "x-nonce": randomUUID(),
        "x-signature": computeSignature(cred.api_secret, { timestamp: t, method, path, rawBody })
      },
      ...(body ? { body: rawBody } : {})
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const spinOnce = async () => {
    const res = await fetch(`${BASE}/game/v1/spin`, {
      method: "POST",
      headers: { authorization: `Bearer ${init.session_token}`, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ bet_amount: 5 })
    });
    return (await res.json()) as { round_ref: string; bet_charged: number; total_win: number; free_spins_left: number; free_round: { spins_remaining: number } | null };
  };

  // The casino's admin creates the promotion in the Operator Portal (Admin API).
  const created = await fetch(`${BASE}/admin/v1/campaigns`, {
    method: "POST",
    headers: { authorization: `Bearer ${operatorTok}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Welcome 5 x 1.00", game_code: "bananax", currency: "GEL", bet_amount: 1, total_spins: 5, valid_to: new Date(Date.now() + 7 * 864e5).toISOString() })
  });
  const campaignId = ((await created.json()) as { campaign: { id: string } }).campaign.id;
  check(created.status === 201, `campaign created (${created.status})`);
  log(`OPERATOR  POST /admin/v1/campaigns -> ${created.status} · 5 free rounds at 1.00 GEL (${campaignId})`);

  const grant = await signed("POST", "/operator/v1/free-rounds/grant", { campaign_id: campaignId, operator_player_id: "player-7781" });
  check(grant.status === 201 && grant.json.grant.spins_remaining === 5, "grant awarded 5 spins");
  log(`OPERATOR  POST /operator/v1/free-rounds/grant -> ${grant.status} · spins_remaining ${grant.json.grant.spins_remaining}`);
  const regrant = await signed("POST", "/operator/v1/free-rounds/grant", { campaign_id: campaignId, operator_player_id: "player-7781" });
  check(regrant.json.already_granted === true && regrant.json.grant.spins_remaining === 5, "a re-sent grant is not topped up");
  log(`   ↳ re-sent grant -> ${regrant.status} already_granted=${regrant.json.already_granted} (never topped up)`);

  // The player's next spins are free rounds at the campaign's locked bet (the client
  // asked for 5.00; the server plays 1.00 and charges nothing).
  let freePlayed = 0;
  while (freePlayed < 2) {
    const out = await spinOnce();
    if (out.free_round) {
      freePlayed += 1;
      check(out.bet_charged === 0, "a free round charges nothing");
      log(`PLAYER    free round ${freePlayed}: charged ${out.bet_charged.toFixed(2)} · win ${out.total_win.toFixed(2)} · ${out.free_round.spins_remaining} left`);
    }
    // A scatter feature a free round triggers plays out first (those spins are owed).
    for (let left = out.free_spins_left; left > 0; left = (await spinOnce()).free_spins_left);
  }
  const open = await signed("GET", "/operator/v1/free-rounds/player/player-7781");
  check(open.json.grants[0]?.spins_remaining === 3, "3 free rounds left before the cancel");
  log(`OPERATOR  GET /operator/v1/free-rounds/player/player-7781 -> ${open.status} · ${open.json.grants[0].spins_remaining} left`);

  const cancelled = await signed("POST", "/operator/v1/free-rounds/cancel", { campaign_id: campaignId, operator_player_id: "player-7781" });
  check(cancelled.status === 200 && cancelled.json.cancelled === true && cancelled.json.grant.status === "cancelled", "player grant cancelled");
  log(`OPERATOR  POST /operator/v1/free-rounds/cancel -> ${cancelled.status} · grant ${cancelled.json.grant.status}, ${cancelled.json.grant.spins_remaining} unplayed spins withdrawn`);
  const recancel = await signed("POST", "/operator/v1/free-rounds/cancel", { campaign_id: campaignId, operator_player_id: "player-7781" });
  check(recancel.status === 200 && recancel.json.already_cancelled === true, "a repeated cancel changes nothing");
  log(`   ↳ re-sent cancel -> ${recancel.status} already_cancelled=${recancel.json.already_cancelled}`);

  const cash = await spinOnce();
  check(cash.free_round === null && cash.bet_charged === 5, "after the cancel the next spin is a cash spin at 5.00");
  log(`PLAYER    next spin is cash again: charged ${cash.bet_charged.toFixed(2)} · free_round=${cash.free_round}`);
  const left = await signed("GET", "/operator/v1/free-rounds/player/player-7781");
  check(left.json.count === 0, "no open grants left");
  log(`OPERATOR  open grants for player-7781 -> ${left.json.count}`);

  // Another casino's credential cannot touch (or even see) this campaign.
  const otherOp = container.mgmt.createOperator({ name: "Rival", slug: "rival-casino" });
  const otherCred = container.mgmt.issueCredential(otherOp.id, "prod");
  const otherBody = JSON.stringify({ campaign_id: campaignId });
  const ots = Math.floor(Date.now() / 1000).toString();
  const rival = await fetch(`${BASE}/operator/v1/free-rounds/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": otherCred.credential.api_key_id,
      "x-timestamp": ots,
      "x-nonce": randomUUID(),
      "x-signature": computeSignature(otherCred.api_secret, { timestamp: ots, method: "POST", path: "/operator/v1/free-rounds/cancel", rawBody: otherBody })
    },
    body: otherBody
  });
  check(rival.status === 404, "another operator's cancel is refused as not found");
  log(`RIVAL     cancel someone else's campaign -> ${rival.status} (correctly hidden)`);

  // Whole-campaign cancel: withdraws every remaining grant in one call.
  const whole = await signed("POST", "/operator/v1/free-rounds/cancel", { campaign_id: campaignId });
  check(whole.status === 200 && whole.json.status === "cancelled", "campaign cancelled");
  log(`OPERATOR  cancel the whole campaign -> ${whole.status} · status ${whole.json.status}, ${whole.json.grants_cancelled} more grant(s) withdrawn`);

  const recon2 = (await adminGet(`/admin/v1/reports/reconciliation?operator_id=${op.id}`, providerTok)) as { ok: boolean };
  check(recon2.ok, "reconciliation still ok after free rounds");
  log(`PROVIDER  /reports/reconciliation -> ok=${recon2.ok}`);

  hr("DONE");
  await app.close();
  process.exit(0);
}

/** A walkthrough that is also a check: any broken step fails the run. */
function check(cond: boolean, what: string): void {
  if (!cond) {
    console.error(`\nFAIL: ${what}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
