import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { AuditRepository } from "../ledger/ledger.types";
import type {
  Operator,
  OperatorStatus,
  OperatorDomain,
  ApiCredential,
  Environment,
  Game,
  MathConfig,
  OperatorGame
} from "./management.types";

const now = (): string => new Date().toISOString();
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Returned only at creation/rotation — the raw secret is never stored or re-shown. */
export interface IssuedCredential {
  credential: ApiCredential;
  api_secret: string;
}

/**
 * Control-plane service: operators, launch domains, API credentials, games, math
 * configs (with an approval gate), and operator↔game assignment. Every mutating
 * action writes a hash-chained audit record. Tenant isolation is enforced by the
 * caller passing the acting operator scope to read methods.
 *
 * Storage is in-memory Maps here; swap for Postgres repositories (same methods)
 * per migrations/0001_core.sql without changing callers.
 */
export class ManagementService {
  private readonly operators = new Map<string, Operator>();
  private readonly slugs = new Map<string, string>(); // slug -> operatorId
  private readonly domains = new Map<string, OperatorDomain>();
  private readonly credentials = new Map<string, ApiCredential>(); // api_key_id -> cred
  // Simulates the secret manager referenced by ApiCredential.hmac_secret_ref. HMAC
  // verification needs the raw secret (unlike a one-way password hash), so it is held
  // here; in production this is KMS-encrypted in a dedicated secret store.
  private readonly secretVault = new Map<string, string>(); // api_key_id -> raw secret
  private readonly games = new Map<string, Game>();
  private readonly mathConfigs = new Map<string, MathConfig>();
  private readonly operatorGames = new Map<string, OperatorGame>();

  constructor(private readonly audit: AuditRepository) {}

  private record(operatorId: string | null, action: string, targetType: string, targetId: string): void {
    this.audit.append({
      operator_id: operatorId,
      actor_type: "admin",
      actor_id: "provider-admin",
      action,
      target_type: targetType,
      target_id: targetId
    });
  }

  // ── Operators ───────────────────────────────────────────────────────────────
  createOperator(input: { name: string; slug: string; default_currency?: string }): Operator {
    if (this.slugs.has(input.slug)) throw new Error(`DUPLICATE_SLUG:${input.slug}`);
    const operator: Operator = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      status: "sandbox",
      default_currency: input.default_currency ?? "GEL",
      created_at: now()
    };
    this.operators.set(operator.id, operator);
    this.slugs.set(operator.slug, operator.id);
    this.record(operator.id, "operator.create", "operator", operator.id);
    return { ...operator };
  }

  getOperator(operatorId: string): Operator {
    const op = this.operators.get(operatorId);
    if (!op) throw new Error("OPERATOR_NOT_FOUND");
    return { ...op };
  }

  /** Provider-scoped: list all operators. */
  listOperators(): Operator[] {
    return Array.from(this.operators.values()).map((o) => ({ ...o }));
  }

  setOperatorStatus(operatorId: string, status: OperatorStatus): Operator {
    const op = this.operators.get(operatorId);
    if (!op) throw new Error("OPERATOR_NOT_FOUND");
    op.status = status;
    this.record(operatorId, `operator.${status === "suspended" ? "suspend" : "status"}`, "operator", operatorId);
    return { ...op };
  }

  assertOperatorActive(operatorId: string): void {
    const op = this.getOperator(operatorId);
    if (op.status === "suspended") throw new Error("OPERATOR_SUSPENDED");
  }

  // ── Domains (launch origin allowlist) ─────────────────────────────────────────
  addDomain(operatorId: string, domain: string, environment: Environment): OperatorDomain {
    this.getOperator(operatorId);
    const rec: OperatorDomain = {
      id: randomUUID(),
      operator_id: operatorId,
      domain: domain.toLowerCase(),
      environment,
      status: "active",
      created_at: now()
    };
    this.domains.set(rec.id, rec);
    this.record(operatorId, "operator.domain.add", "operator_domain", rec.id);
    return { ...rec };
  }

  isDomainAllowed(operatorId: string, domain: string, environment: Environment): boolean {
    const d = domain.toLowerCase();
    for (const rec of this.domains.values()) {
      if (
        rec.operator_id === operatorId &&
        rec.environment === environment &&
        rec.status === "active" &&
        rec.domain === d
      ) {
        return true;
      }
    }
    return false;
  }

  // ── API credentials ───────────────────────────────────────────────────────────
  issueCredential(operatorId: string, environment: Environment, ipAllowlist: string[] = []): IssuedCredential {
    this.getOperator(operatorId);
    const apiKeyId = `ak_${randomBytes(9).toString("hex")}`;
    const apiSecret = randomBytes(32).toString("hex");
    const credential: ApiCredential = {
      id: randomUUID(),
      operator_id: operatorId,
      api_key_id: apiKeyId,
      secret_hash: sha256(apiSecret),
      secret_last4: apiSecret.slice(-4),
      environment,
      status: "active",
      ip_allowlist: [...ipAllowlist],
      created_at: now(),
      expires_at: null
    };
    this.credentials.set(apiKeyId, credential);
    this.secretVault.set(apiKeyId, apiSecret);
    this.record(operatorId, "credential.issue", "api_credential", apiKeyId);
    return { credential: { ...credential }, api_secret: apiSecret };
  }

  /** Verify an HMAC api secret against a stored credential (constant-ish for demo). */
  verifySecret(apiKeyId: string, presentedSecret: string): boolean {
    const cred = this.credentials.get(apiKeyId);
    if (!cred || cred.status === "revoked") return false;
    return cred.secret_hash === sha256(presentedSecret);
  }

  /** Read-only credential lookup (clone) for auth middleware. */
  getCredential(apiKeyId: string): ApiCredential | null {
    const cred = this.credentials.get(apiKeyId);
    return cred ? { ...cred } : null;
  }

  /** Retrieve the raw HMAC secret for an active/rotating credential (signing verification). */
  getHmacSecret(apiKeyId: string): string | null {
    const cred = this.credentials.get(apiKeyId);
    if (!cred || cred.status === "revoked") return null;
    return this.secretVault.get(apiKeyId) ?? null;
  }

  /**
   * Rotate a credential's secret with a grace window: the old credential moves to
   * `rotating` (still valid) and a NEW active credential is issued. Cut over, then
   * call revokeCredential on the old key. Returns the new issued credential.
   */
  rotateCredential(operatorId: string, oldApiKeyId: string): IssuedCredential {
    const old = this.credentials.get(oldApiKeyId);
    if (!old || old.operator_id !== operatorId) throw new Error("CREDENTIAL_NOT_FOUND");
    if (old.status === "revoked") throw new Error("CREDENTIAL_REVOKED");
    old.status = "rotating";
    const issued = this.issueCredential(operatorId, old.environment, old.ip_allowlist);
    this.record(operatorId, "credential.rotate", "api_credential", oldApiKeyId);
    return issued;
  }

  revokeCredential(operatorId: string, apiKeyId: string): ApiCredential {
    const cred = this.credentials.get(apiKeyId);
    if (!cred || cred.operator_id !== operatorId) throw new Error("CREDENTIAL_NOT_FOUND");
    cred.status = "revoked";
    this.secretVault.delete(apiKeyId);
    this.record(operatorId, "credential.revoke", "api_credential", apiKeyId);
    return { ...cred };
  }

  // ── Games & math configs ──────────────────────────────────────────────────────
  registerGame(input: { code: string; title: string }): Game {
    const game: Game = {
      id: randomUUID(),
      code: input.code,
      title: input.title,
      status: "draft",
      created_at: now()
    };
    this.games.set(game.id, game);
    this.record(null, "game.register", "game", game.id);
    return { ...game };
  }

  createMathConfig(input: {
    game_id: string;
    version: string;
    rtp_profile_key: string;
    theoretical_rtp: number;
    config_hash: string;
  }): MathConfig {
    if (!this.games.has(input.game_id)) throw new Error("GAME_NOT_FOUND");
    const cfg: MathConfig = {
      id: randomUUID(),
      game_id: input.game_id,
      version: input.version,
      rtp_profile_key: input.rtp_profile_key,
      theoretical_rtp: input.theoretical_rtp,
      config_hash: input.config_hash,
      status: "draft",
      approved_by: null,
      approved_at: null,
      created_at: now()
    };
    this.mathConfigs.set(cfg.id, cfg);
    this.record(null, "math_config.create", "math_config", cfg.id);
    return { ...cfg };
  }

  submitMathConfigForReview(mathConfigId: string): MathConfig {
    const cfg = this.mathConfigs.get(mathConfigId);
    if (!cfg) throw new Error("MATH_CONFIG_NOT_FOUND");
    if (cfg.status !== "draft") throw new Error("INVALID_STATE_TRANSITION");
    cfg.status = "in_review";
    this.record(null, "math_config.submit", "math_config", cfg.id);
    return { ...cfg };
  }

  approveMathConfig(mathConfigId: string, approver: string): MathConfig {
    const cfg = this.mathConfigs.get(mathConfigId);
    if (!cfg) throw new Error("MATH_CONFIG_NOT_FOUND");
    if (cfg.status !== "in_review") throw new Error("INVALID_STATE_TRANSITION");
    cfg.status = "approved";
    cfg.approved_by = approver;
    cfg.approved_at = now();
    this.record(null, "math_config.approve", "math_config", cfg.id);
    return { ...cfg };
  }

  // ── Assignment ────────────────────────────────────────────────────────────────
  assignGame(input: {
    operator_id: string;
    game_id: string;
    math_config_id: string;
    currency: string;
    jurisdiction?: string;
    allowed_bets: number[];
  }): OperatorGame {
    this.getOperator(input.operator_id);
    if (!this.games.has(input.game_id)) throw new Error("GAME_NOT_FOUND");
    const cfg = this.mathConfigs.get(input.math_config_id);
    if (!cfg) throw new Error("MATH_CONFIG_NOT_FOUND");
    // Certification gate: only an approved/active math config can go live.
    if (cfg.status !== "approved" && cfg.status !== "active") {
      throw new Error("CONFIG_NOT_APPROVED");
    }
    if (cfg.game_id !== input.game_id) throw new Error("CONFIG_GAME_MISMATCH");
    const rec: OperatorGame = {
      id: randomUUID(),
      operator_id: input.operator_id,
      game_id: input.game_id,
      math_config_id: input.math_config_id,
      currency: input.currency,
      jurisdiction: input.jurisdiction ?? "GE",
      allowed_bets: [...input.allowed_bets],
      status: "enabled",
      created_at: now()
    };
    this.operatorGames.set(rec.id, rec);
    this.record(input.operator_id, "operator.game.assign", "operator_game", rec.id);
    return { ...rec };
  }

  /** Provider-scoped: list the global game catalog. */
  listGames(): Game[] {
    return Array.from(this.games.values()).map((g) => ({ ...g }));
  }

  /** Provider-scoped: list all math configs (across games). */
  listMathConfigs(): MathConfig[] {
    return Array.from(this.mathConfigs.values()).map((c) => ({ ...c }));
  }

  /** Read a game + its specific math config in one go (admin inspector enrichment). */
  getGameAndConfig(gameId: string, mathConfigId: string): { game: Game | null; config: MathConfig | null } {
    const game = this.games.get(gameId);
    const config = this.mathConfigs.get(mathConfigId);
    return { game: game ? { ...game } : null, config: config ? { ...config } : null };
  }

  /** Tenant-scoped read: an operator can only ever see its own assignments. */
  listOperatorGames(operatorId: string): OperatorGame[] {
    return Array.from(this.operatorGames.values())
      .filter((og) => og.operator_id === operatorId)
      .map((og) => ({ ...og }));
  }

  findOperatorGame(operatorId: string, gameCode: string, currency: string): OperatorGame | null {
    const game = Array.from(this.games.values()).find((g) => g.code === gameCode);
    if (!game) return null;
    const found = Array.from(this.operatorGames.values()).find(
      (og) =>
        og.operator_id === operatorId &&
        og.game_id === game.id &&
        og.currency === currency &&
        og.status === "enabled"
    );
    return found ? { ...found } : null;
  }
}
