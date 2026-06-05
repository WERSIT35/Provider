import { describe, it, expect } from "vitest";
import { ManagementService } from "../src/modules/management/management.service";
import { InMemoryAuditRepository } from "../src/modules/ledger/memory-repositories";

function setup() {
  const audit = new InMemoryAuditRepository();
  const svc = new ManagementService(audit);
  return { svc, audit };
}

/** Register a game + approved math config; returns ids. */
function approvedConfig(svc: ManagementService) {
  const game = svc.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = svc.createMathConfig({
    game_id: game.id,
    version: "3.0.0",
    rtp_profile_key: "bananax",
    theoretical_rtp: 96.38,
    config_hash: "abc123"
  });
  cfg = svc.submitMathConfigForReview(cfg.id);
  cfg = svc.approveMathConfig(cfg.id, "math-lead@provider");
  return { gameId: game.id, configId: cfg.id };
}

describe("ManagementService (Phase 3 control plane)", () => {
  it("creates operators and rejects duplicate slugs", () => {
    const { svc } = setup();
    const op = svc.createOperator({ name: "Casino One", slug: "casino-one" });
    expect(op.status).toBe("sandbox");
    expect(() => svc.createOperator({ name: "Dup", slug: "casino-one" })).toThrow(/DUPLICATE_SLUG/);
  });

  it("enforces the domain launch allowlist", () => {
    const { svc } = setup();
    const op = svc.createOperator({ name: "Casino One", slug: "casino-one" });
    svc.addDomain(op.id, "casino.example.com", "prod");
    expect(svc.isDomainAllowed(op.id, "casino.example.com", "prod")).toBe(true);
    expect(svc.isDomainAllowed(op.id, "evil.example.com", "prod")).toBe(false);
    expect(svc.isDomainAllowed(op.id, "casino.example.com", "sandbox")).toBe(false);
  });

  it("issues, verifies, rotates (grace window), and revokes credentials", () => {
    const { svc } = setup();
    const op = svc.createOperator({ name: "Casino One", slug: "casino-one" });
    const issued = svc.issueCredential(op.id, "sandbox", ["203.0.113.0/24"]);
    expect(issued.api_secret).toHaveLength(64);
    expect(svc.verifySecret(issued.credential.api_key_id, issued.api_secret)).toBe(true);
    expect(svc.verifySecret(issued.credential.api_key_id, "wrong")).toBe(false);

    // Rotation: old key stays valid (grace) while the new one is issued.
    const rotated = svc.rotateCredential(op.id, issued.credential.api_key_id);
    expect(svc.verifySecret(issued.credential.api_key_id, issued.api_secret)).toBe(true);
    expect(svc.verifySecret(rotated.credential.api_key_id, rotated.api_secret)).toBe(true);

    // Cut over: revoke the old key.
    svc.revokeCredential(op.id, issued.credential.api_key_id);
    expect(svc.verifySecret(issued.credential.api_key_id, issued.api_secret)).toBe(false);
  });

  it("blocks assigning a game on an unapproved math config (certification gate)", () => {
    const { svc } = setup();
    const op = svc.createOperator({ name: "Casino One", slug: "casino-one" });
    const game = svc.registerGame({ code: "bananax", title: "Banana X" });
    const draft = svc.createMathConfig({
      game_id: game.id,
      version: "3.0.0",
      rtp_profile_key: "bananax",
      theoretical_rtp: 96.38,
      config_hash: "abc123"
    });
    expect(() =>
      svc.assignGame({
        operator_id: op.id,
        game_id: game.id,
        math_config_id: draft.id,
        currency: "GEL",
        allowed_bets: [1, 5, 500]
      })
    ).toThrow(/CONFIG_NOT_APPROVED/);
  });

  it("assigns a game once the math config is approved and scopes reads per operator", () => {
    const { svc } = setup();
    const a = svc.createOperator({ name: "A", slug: "a" });
    const b = svc.createOperator({ name: "B", slug: "b" });
    const { gameId, configId } = approvedConfig(svc);

    svc.assignGame({
      operator_id: a.id,
      game_id: gameId,
      math_config_id: configId,
      currency: "GEL",
      allowed_bets: [1, 5, 500]
    });

    // Tenant isolation: B sees nothing of A's assignments.
    expect(svc.listOperatorGames(a.id)).toHaveLength(1);
    expect(svc.listOperatorGames(b.id)).toHaveLength(0);
    expect(svc.findOperatorGame(a.id, "bananax", "GEL")).not.toBeNull();
    expect(svc.findOperatorGame(b.id, "bananax", "GEL")).toBeNull();
  });

  it("suspends an operator and records an immutable audit trail", () => {
    const { svc, audit } = setup();
    const op = svc.createOperator({ name: "Casino One", slug: "casino-one" });
    svc.setOperatorStatus(op.id, "suspended");
    expect(() => svc.assertOperatorActive(op.id)).toThrow(/OPERATOR_SUSPENDED/);

    // Audit chain captured the actions and verifies intact.
    expect(audit.verifyChain().ok).toBe(true);
    const actions = audit.list({ operator_id: op.id }).map((a) => a.action);
    expect(actions).toContain("operator.create");
    expect(actions).toContain("operator.suspend");
  });
});
