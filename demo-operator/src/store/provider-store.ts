import { randomUUID } from "node:crypto";
import type { DemoOperatorConfig } from "../config";

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

export class ProviderStore {
  private readonly providers = new Map<string, ProviderConfig>();

  constructor(cfg?: DemoOperatorConfig) {
    if (cfg) {
      // Seed the initial provider from .env to keep the demo working out of the box
      const initial: ProviderConfig = {
        id: "default-provider",
        name: "Initial Platform (from .env)",
        platformUrl: cfg.platformUrl,
        operatorId: cfg.operatorId,
        apiKeyId: cfg.apiKeyId,
        apiSecret: cfg.apiSecret,
        webhookSecret: cfg.webhookSecret,
        adminToken: cfg.adminToken
      };
      this.providers.set(initial.id, initial);
    }
  }

  getAll(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  getById(id: string): ProviderConfig | null {
    const p = this.providers.get(id);
    return p ? { ...p } : null;
  }

  add(config: Omit<ProviderConfig, "id">): ProviderConfig {
    const id = randomUUID();
    const p: ProviderConfig = { id, ...config };
    this.providers.set(id, p);
    return { ...p };
  }

  update(id: string, config: Omit<ProviderConfig, "id">): ProviderConfig {
    if (!this.providers.has(id)) throw new Error("PROVIDER_NOT_FOUND");
    const p: ProviderConfig = { id, ...config };
    this.providers.set(id, p);
    return { ...p };
  }

  delete(id: string): void {
    this.providers.delete(id);
  }
}
