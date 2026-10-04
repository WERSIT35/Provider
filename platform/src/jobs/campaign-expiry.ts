import type { FastifyBaseLogger } from "fastify";
import type { InMemoryCampaignRepository } from "../modules/campaigns/campaign.repository";
import type { Persistence } from "../persistence/persistence";

/**
 * Background expiry for operator free-round grants.
 *
 * Grants already expire lazily when a player's grants are read or spun; this sweep closes
 * the rest (players who never come back), so reports and the Campaign Manager show
 * "expired" instead of a stale "active" with spins left.
 *
 * Safe alongside live spins: expireDue() is synchronous (no await between check and
 * write) on Node's single thread, exactly like the spin path's own lazy expiry. Because
 * it runs outside an HTTP request, the per-request write-through flush never fires for
 * it, so the sweep flushes its own mutations. flush() swaps its pending batch before the
 * first await, so it never races a request's flush, and versioned upserts keep ordering.
 */
export interface CampaignExpiryJob {
  /** Run one sweep now; resolves with the number of grants expired. */
  runOnce(): Promise<number>;
  stop(): void;
}

export function startCampaignExpiry(deps: {
  campaigns: InMemoryCampaignRepository;
  persistence: Persistence;
  logger: FastifyBaseLogger;
  intervalMs: number;
  now?: () => string;
}): CampaignExpiryJob {
  const now = deps.now ?? (() => new Date().toISOString());
  let running = false;

  const runOnce = async (): Promise<number> => {
    if (running) return 0; // a slow flush must not stack sweeps
    running = true;
    try {
      const expired = deps.campaigns.expireDue(now());
      if (expired > 0) {
        await deps.persistence.flush();
        deps.logger.info({ expired }, "campaign_grants_expired");
      }
      return expired;
    } catch (err) {
      deps.logger.error({ err }, "campaign_expiry_failed");
      return 0;
    } finally {
      running = false;
    }
  };

  // Sweep once at start-up (grants that lapsed while the server was down), then on the interval.
  void runOnce();
  const timer = deps.intervalMs > 0 ? setInterval(() => void runOnce(), deps.intervalMs) : null;
  timer?.unref(); // never keeps the process alive on its own

  return {
    runOnce,
    stop: () => {
      if (timer) clearInterval(timer);
    }
  };
}
