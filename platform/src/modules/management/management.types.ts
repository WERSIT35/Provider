/** Operator/game control-plane entities (plan §3.1/§3.2). In-memory for now; the
 * Postgres schema in migrations/0001_core.sql is the production storage. */

export type OperatorStatus = "sandbox" | "live" | "suspended";
export type Environment = "sandbox" | "prod";
export type MathConfigStatus = "draft" | "in_review" | "approved" | "active" | "archived";

export interface Operator {
  id: string;
  name: string;
  slug: string;
  status: OperatorStatus;
  default_currency: string;
  created_at: string;
}

export interface OperatorDomain {
  id: string;
  operator_id: string;
  domain: string;
  environment: Environment;
  status: "active" | "disabled";
  created_at: string;
}

export type CredentialStatus = "active" | "rotating" | "revoked";

export interface ApiCredential {
  id: string;
  operator_id: string;
  api_key_id: string;
  /** sha256 of the raw secret — the raw secret is shown to the caller exactly once. */
  secret_hash: string;
  secret_last4: string;
  environment: Environment;
  status: CredentialStatus;
  ip_allowlist: string[];
  created_at: string;
  expires_at: string | null;
}

export interface Game {
  id: string;
  code: string;
  title: string;
  status: "draft" | "certified" | "live" | "retired";
  created_at: string;
}

export interface MathConfig {
  id: string;
  game_id: string;
  version: string;
  rtp_profile_key: string;
  theoretical_rtp: number;
  config_hash: string;
  status: MathConfigStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface OperatorGame {
  id: string;
  operator_id: string;
  game_id: string;
  math_config_id: string;
  currency: string;
  jurisdiction: string;
  allowed_bets: number[];
  status: "enabled" | "disabled";
  created_at: string;
}
