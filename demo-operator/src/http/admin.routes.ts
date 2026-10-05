import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { Player, PlayerStore } from "../store/player-store";
import type { ProviderConfig, ProviderStore } from "../store/provider-store";

const SECRET_FIELDS = ["apiSecret", "webhookSecret", "adminToken"] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

/** Never send credentials to the browser: show only that a secret is set and its last 4 chars. */
function maskProvider(p: ProviderConfig): Omit<ProviderConfig, SecretField> & Record<SecretField, string> {
  const masked = { ...p } as ProviderConfig;
  for (const f of SECRET_FIELDS) masked[f] = p[f] ? `••••${p[f].slice(-4)}` : "";
  return masked;
}

/** Player rows for staff: no password hash. */
const publicPlayer = ({ passwordHash: _omit, ...rest }: Player): Omit<Player, "passwordHash"> => rest;

export interface AdminRouteOptions {
  /** Staff-session preHandler applied to every route in this plugin. */
  guard: preHandlerHookHandler;
  /** Operator Portal base for "Verify on provider"; falls back to the provider's platform URL. */
  providerPortalUrl?: string;
}

export default function adminRoutes(playerStore: PlayerStore, providerStore: ProviderStore, opts: AdminRouteOptions): FastifyPluginAsync {
  return async (app) => {
    // Encapsulated: applies to every /api/admin/* route registered below, and only to them.
    app.addHook("preHandler", opts.guard);

    // Players
    app.get("/api/admin/players", async () => {
      return { players: playerStore.getAllPlayers().map(publicPlayer) };
    });

    // Raw wallet ledger rows (as written by the RGS webhooks), newest first.
    app.get("/api/admin/transactions", async (req) => {
      const limit = Number((req.query as { limit?: string }).limit) || 500;
      return { transactions: playerStore.getAllTransactions(Math.min(Math.max(limit, 1), 5000)) };
    });

    // Rounds (wager + win per round_ref), each with its provider-side verification link.
    app.get("/api/admin/rounds", async (req) => {
      const q = req.query as { limit?: string; player?: string };
      const portalFor = new Map<string, string>();
      const rounds = playerStore.recentRounds({ limit: Number(q.limit) || 100, playerId: q.player || undefined }).map((r) => {
        if (!portalFor.has(r.providerId)) {
          const base = opts.providerPortalUrl ?? providerStore.getById(r.providerId)?.platformUrl ?? "";
          portalFor.set(r.providerId, base.replace(/\/$/, ""));
        }
        const base = portalFor.get(r.providerId);
        return { ...r, verifyUrl: base ? `${base}/admin#inspector?round=${encodeURIComponent(r.roundRef)}` : null };
      });
      // Bonus grouping: a round that triggered a feature gets its group summary (free
      // spins carry featureRef = that round's ref). Summed over the whole ledger.
      const bonuses = playerStore.bonusSummaries(rounds.map((r) => r.roundRef));
      return { rounds: rounds.map((r) => ({ ...r, bonus: bonuses.get(r.roundRef) ?? null })) };
    });

    // Providers
    app.get("/api/admin/providers", async () => {
      return { providers: providerStore.getAll().map(maskProvider) };
    });

    app.post("/api/admin/providers", async (req, reply) => {
      const body = (req.body ?? {}) as Partial<ProviderConfig>;
      if (!body.name || !body.platformUrl || !body.operatorId || !body.apiKeyId || !body.apiSecret || !body.webhookSecret || !body.adminToken) {
        return reply.code(400).send({ error: "Missing required provider fields" });
      }
      const { id: _ignored, ...fields } = body as ProviderConfig;
      return { provider: maskProvider(providerStore.add(fields)) };
    });

    app.put("/api/admin/providers/:id", async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const existing = providerStore.getById(id);
      if (!existing) return reply.code(404).send({ error: "Provider not found" });
      const body = (req.body ?? {}) as Partial<ProviderConfig>;
      const { id: _ignored, ...current } = existing;
      const next = { ...current };
      for (const key of Object.keys(current) as Array<keyof typeof current>) {
        const v = body[key];
        // A blank or still-masked secret means "keep the stored one".
        if (typeof v !== "string" || v === "" || ((SECRET_FIELDS as readonly string[]).includes(key) && v.startsWith("••••"))) continue;
        next[key] = v;
      }
      return { provider: maskProvider(providerStore.update(id, next)) };
    });

    app.delete("/api/admin/providers/:id", async (req) => {
      providerStore.delete((req.params as { id: string }).id);
      return { ok: true };
    });
  };
}
