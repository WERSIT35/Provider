import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import type { CreditArgs, WalletContext, WalletTxResult } from "../src/modules/wallet/wallet.types";
import { deriveFeatureFamilies } from "../src/modules/ledger/feature-family";
import type { RoundRecord } from "../src/modules/ledger/ledger.types";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/** Records every credit, so the inspector's families can be checked against the featureRef actually sent. */
class RecordingWallet extends SandboxWallet {
  credits: CreditArgs[] = [];
  override async credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
    this.credits.push({ ...args });
    return super.credit(ctx, args);
  }
}

const rnd = (r: Partial<RoundRecord> & { round_ref: string; seq: number }): RoundRecord =>
  ({ session_id: "s", is_free_spin: false, outcome: { free_spins_awarded: 0 }, ...r }) as unknown as RoundRecord;

describe("deriveFeatureFamilies (pure)", () => {
  it("groups a trigger with its consecutive free spins, per session order", () => {
    const fam = deriveFeatureFamilies([
      rnd({ round_ref: "p1", seq: 1 }),
      rnd({ round_ref: "t1", seq: 2, outcome: { free_spins_awarded: 15 } as never }),
      rnd({ round_ref: "f1", seq: 3, is_free_spin: true }),
      rnd({ round_ref: "f2", seq: 4, is_free_spin: true, outcome: { free_spins_awarded: 5 } as never }), // a retrigger stays in the family
      rnd({ round_ref: "f3", seq: 5, is_free_spin: true }),
      rnd({ round_ref: "p2", seq: 6 }),
      rnd({ round_ref: "t2", seq: 8, outcome: { free_spins_awarded: 15 } as never }),
      rnd({ round_ref: "g1", seq: 9, is_free_spin: true })
    ].reverse()); // input order must not matter
    expect(fam.get("p1")).toBeUndefined();
    expect(fam.get("p2")).toBeUndefined();
    expect(fam.get("t1")).toEqual({ feature_ref: "t1", role: "trigger", index: 0, free_spins: 3 });
    expect(fam.get("f2")).toEqual({ feature_ref: "t1", role: "free_spin", index: 2, free_spins: 3 });
    expect(fam.get("f3")?.index).toBe(3);
    expect(fam.get("g1")).toEqual({ feature_ref: "t2", role: "free_spin", index: 1, free_spins: 1 });
  });

  it("leaves orphan free spins (no trigger in the ledger) and a trigger with no spins ungrouped", () => {
    const fam = deriveFeatureFamilies([
      rnd({ round_ref: "orphan", seq: 1, is_free_spin: true }),
      rnd({ round_ref: "t", seq: 2, outcome: { free_spins_awarded: 15 } as never }) // capped on the trigger: no spins played
    ]);
    expect(fam.size).toBe(0);
  });
});

describe("Round Inspector: bonus families, forensics and player search", () => {
  let app: FastifyInstance;
  let c: Container;
  let wallet: RecordingWallet;
  let opA: string;
  let opB: string;
  let provider: string;
  let operatorA: string;
  let operatorB: string;
  const triggers: string[] = [];

  beforeAll(async () => {
    wallet = new RecordingWallet();
    c = buildContainer(CONFIG, { wallet });
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
    await app.ready();
    const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    const ops: string[] = [];
    for (const slug of ["alpha", "beta"]) {
      const op = c.mgmt.createOperator({ name: slug, slug });
      c.mgmt.addDomain(op.id, "casino.example.com", "prod");
      c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
      ops.push(op.id);
    }
    [opA, opB] = ops;
    provider = c.adminAuth.mintToken({ admin_id: "prov", scope: "provider", role: "provider_super_admin" });
    operatorA = c.adminAuth.mintToken({ admin_id: "a", scope: "operator", operator_id: opA, role: "operator_admin" });
    operatorB = c.adminAuth.mintToken({ admin_id: "b", scope: "operator", operator_id: opB, role: "operator_admin" });

    // "shared" exists at both operators (player ids are only unique per operator).
    for (const [op, player] of [[opA, "shared"], [opB, "shared"]] as const) {
      wallet.setBalance(player, "GEL", 1_000_000);
      const s = c.sessions.initSession(c.sessions.createLaunchToken({ operator_id: op, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: "casino.example.com" }));
      let k = 0;
      for (let i = 0; i < 20; i++) await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `${op}-p${k++}` });
      if (op === opA) {
        for (let b = 0; b < 3; b++) {
          const buy = await c.orchestrator.buyFeature(s.id, { bet_amount: 1, idempotency_key: `${op}-buy${b}` });
          triggers.push(buy.round_ref);
          while (c.sessions.get(s.id).free_spins_left > 0) await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `${op}-fs${k++}` });
        }
        for (let i = 0; i < 5; i++) await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `${op}-p${k++}` });
      }
    }
  });

  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  it("a free spin opens with its whole family; any member yields the same timeline", async () => {
    const trigger = triggers[0];
    const head = (await get(`/admin/v1/rounds/${trigger}`, provider)).json();
    expect(head.feature).not.toBeNull();
    const f = head.feature;
    expect(f.feature_ref).toBe(trigger);
    expect(f.position).toBe(0);
    expect(f.spins[0]).toMatchObject({ round_ref: trigger, role: "trigger", index: 0 });
    expect(f.free_spins).toBe(f.spins.length - 1);
    expect(f.free_spins).toBeGreaterThanOrEqual(15);
    // Every free spin of the family is a free spin, in ledger order.
    for (const s of f.spins.slice(1)) expect(c.ledger.getRound(s.round_ref)!.is_free_spin).toBe(true);
    const seqs = f.spins.map((s: { round_ref: string }) => c.ledger.getRound(s.round_ref)!.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    const mid = f.spins[Math.floor(f.spins.length / 2)];
    const fromMember = (await get(`/admin/v1/rounds/${mid.round_ref}`, provider)).json();
    expect(fromMember.feature.spins.map((s: { round_ref: string }) => s.round_ref)).toEqual(f.spins.map((s: { round_ref: string }) => s.round_ref));
    expect(fromMember.feature.position).toBe(mid.index);

    // A plain paid spin has no family.
    const plain = c.reporting.listRoundsByPlayer(opA, "shared").find((r) => !r.is_free_spin && !triggers.includes(r.round_ref))!;
    expect((await get(`/admin/v1/rounds/${plain.round_ref}`, provider)).json().feature).toBeNull();
  });

  it("families match the featureRef the casino received on every free-spin credit", async () => {
    const freeCredits = wallet.credits.filter((x) => x.roundType === "free_spin");
    expect(freeCredits.length).toBeGreaterThan(0);
    for (const credit of freeCredits) {
      const fam = (await get(`/admin/v1/rounds/${credit.roundRef}`, provider)).json().feature;
      expect(fam.feature_ref).toBe(credit.featureRef);
    }
  });

  it("bank and running win chain spin to spin, and the totals are what was paid", async () => {
    for (const trigger of triggers) {
      const f = (await get(`/admin/v1/rounds/${trigger}`, provider)).json().feature;
      let paid = 0;
      f.spins.forEach((s: { total_win: number; bonus_running_win: number; bank_before: number | null; bank_after: number | null }, i: number) => {
        paid = Number((paid + s.total_win).toFixed(2));
        expect(s.bonus_running_win).toBe(paid);
        if (i === 0) { expect(s.bank_before).toBeNull(); return; }
        if (i === 1) expect(s.bank_before).toBe(0); // the bank starts empty
        else expect(s.bank_before).toBe(f.spins[i - 1].bank_after); // and carries spin to spin
        expect(s.bank_after).toBeGreaterThanOrEqual(s.bank_before!); // it only ever grows
      });
      expect(f.total_win).toBe(paid);
      const sumLedger = f.spins.reduce((a: number, s: { round_ref: string }) => a + c.ledger.getRound(s.round_ref)!.total_win, 0);
      expect(f.total_win).toBeCloseTo(sumLedger, 2);
      expect(f.final_bank).toBe(f.spins[f.spins.length - 1].bank_after);
    }
  });

  it("the HUD's pay arithmetic reproduces every stored win (round(raw × scaler) + scatter, × multiplier)", async () => {
    const refs = c.reporting.listRoundsByPlayer(opA, "shared").map((r) => r.round_ref);
    let checked = 0;
    for (const ref of refs) {
      const r = (await get(`/admin/v1/rounds/${ref}`, provider)).json();
      expect(r.pays).not.toBeNull();
      const steps = r.outcome.tumble_steps as Array<{ win_total: number }>;
      const raw = steps.reduce((s, b) => s + Number(b.win_total || 0), 0);
      const pre = Number((Number((raw * r.pays.scaler).toFixed(2)) + Number(r.outcome.scatter_win || 0)).toFixed(2));
      const expected = Number((pre * Number(r.outcome.multiplier_applied || 1)).toFixed(2));
      const capped = (r.outcome.events as Array<{ type: string }>).some((e) => /MAX_WIN_CAP/.test(e.type));
      if (!capped) { expect(expected).toBe(r.total_win); checked++; }
      // tumble_steps[0] is the spin's board; outcome.matrix is the FINAL board.
      expect(r.outcome.matrix).toEqual(steps[steps.length - 1] && (steps[steps.length - 1] as unknown as { matrix: unknown }).matrix);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("player search: newest first, bonus tags, game and currency", async () => {
    const res = await get(`/admin/v1/players/shared/rounds?operator_id=${opA}`, provider);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(body.total);
    const rounds = body.rounds as Array<{ round_ref: string; created_at: string; game_code: string; currency: string; operator_slug: string; feature: { feature_ref: string; role: string; index: number; free_spins: number } | null }>;
    for (let i = 1; i < rounds.length; i++) expect(rounds[i - 1].created_at >= rounds[i].created_at).toBe(true);
    expect(rounds.every((r) => r.game_code === "bananax" && r.currency === "GEL" && r.operator_slug === "alpha")).toBe(true);
    for (const t of triggers) {
      const tag = rounds.find((r) => r.round_ref === t)!.feature!;
      expect(tag).toMatchObject({ feature_ref: t, role: "trigger", index: 0 });
      const members = rounds.filter((r) => r.feature?.feature_ref === t && r.feature.role === "free_spin");
      expect(members).toHaveLength(tag.free_spins);
    }
    // limit keeps the newest rows; bonus tags are still derived from the whole session.
    const limited = (await get(`/admin/v1/players/shared/rounds?operator_id=${opA}&limit=3`, provider)).json();
    expect(limited.count).toBe(3);
    expect(limited.total).toBe(body.total);
    expect(limited.rounds.map((r: { round_ref: string }) => r.round_ref)).toEqual(rounds.slice(0, 3).map((r) => r.round_ref));
  });

  it("player search scoping: provider may search all operators; operators only ever see their own", async () => {
    const all = (await get(`/admin/v1/players/shared/rounds`, provider)).json();
    expect(new Set(all.rounds.map((r: { operator_slug: string }) => r.operator_slug))).toEqual(new Set(["alpha", "beta"]));
    expect(all.operator_id).toBeNull();

    const asB = (await get(`/admin/v1/players/shared/rounds?operator_id=${opA}`, operatorB)).json(); // asks for A, pinned to B
    expect(asB.operator_id).toBe(opB);
    expect(asB.rounds.every((r: { operator_id: string }) => r.operator_id === opB)).toBe(true);
    const asA = (await get(`/admin/v1/players/shared/rounds`, operatorA)).json();
    expect(asA.rounds.every((r: { operator_id: string }) => r.operator_id === opA)).toBe(true);

    // A bonus round of operator A is invisible (404) to operator B, family and all.
    expect((await get(`/admin/v1/rounds/${triggers[0]}`, operatorB)).statusCode).toBe(404);
    expect((await get(`/admin/v1/rounds/${triggers[0]}`, operatorA)).json().feature.feature_ref).toBe(triggers[0]);
  });
});
