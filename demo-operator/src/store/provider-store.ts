import { randomUUID } from "node:crypto";
import type { DemoOperatorConfig } from "../config";
import { openCasinoDb, type CasinoDatabase } from "../db/database";

export interface ProviderConfig {
  id: string;
  name: string;
  platformUrl: string;
  operatorId: string;
  apiKeyId: string;
  apiSecret: string;
  webhookSecret: string;
  adminToken: string;
}

interface ProviderRow {
  id: string; name: string; platform_url: string; operator_id: string; api_key_id: string;
  api_secret: string; webhook_secret: string; admin_token: string; created_at: string;
}

const toProvider = (r: ProviderRow): ProviderConfig => ({
  id: r.id, name: r.name, platformUrl: r.platform_url, operatorId: r.operator_id, apiKeyId: r.api_key_id,
  apiSecret: r.api_secret, webhookSecret: r.webhook_secret, adminToken: r.admin_token
});

/**
 * Game providers this casino integrates with (one entry per RGS), persisted in SQLite.
 * The `default-provider` entry is (re)written from .env on every boot, so re-seeding the
 * platform and rewriting .env takes effect on restart; providers added in the back-office
 * persist as they are.
 */
export class ProviderStore {
  constructor(cfg?: DemoOperatorConfig, private readonly db: CasinoDatabase = openCasinoDb()) {
    if (cfg) {
      this.upsert({
        id: "default-provider",
        name: "Initial Platform (from .env)",
        platformUrl: cfg.platformUrl,
        operatorId: cfg.operatorId,
        apiKeyId: cfg.apiKeyId,
        apiSecret: cfg.apiSecret,
        webhookSecret: cfg.webhookSecret,
        adminToken: cfg.adminToken
      });
    }
  }

  getAll(): ProviderConfig[] {
    return (this.db.prepare("SELECT * FROM providers ORDER BY created_at").all() as unknown as ProviderRow[]).map(toProvider);
  }

  getById(id: string): ProviderConfig | null {
    const r = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    return r ? toProvider(r) : null;
  }

  add(config: Omit<ProviderConfig, "id">): ProviderConfig {
    return this.upsert({ id: randomUUID(), ...config });
  }

  update(id: string, config: Omit<ProviderConfig, "id">): ProviderConfig {
    if (!this.getById(id)) throw new Error("PROVIDER_NOT_FOUND");
    return this.upsert({ id, ...config });
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM providers WHERE id = ?").run(id);
  }

  private upsert(p: ProviderConfig): ProviderConfig {
    this.db.prepare(`
      INSERT INTO providers (id, name, platform_url, operator_id, api_key_id, api_secret, webhook_secret, admin_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name, platform_url = excluded.platform_url, operator_id = excluded.operator_id,
        api_key_id = excluded.api_key_id, api_secret = excluded.api_secret,
        webhook_secret = excluded.webhook_secret, admin_token = excluded.admin_token`).run(
      p.id, p.name, p.platformUrl, p.operatorId, p.apiKeyId, p.apiSecret, p.webhookSecret, p.adminToken,
      new Date().toISOString()
    );
    return { ...p };
  }
}
