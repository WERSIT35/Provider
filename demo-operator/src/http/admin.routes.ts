import type { FastifyPluginAsync } from "fastify";
import type { PlayerStore } from "../store/player-store";
import type { ProviderStore } from "../store/provider-store";

export default function adminRoutes(playerStore: PlayerStore, providerStore: ProviderStore): FastifyPluginAsync {
  return async (app) => {
    // Players
    app.get("/api/admin/players", async () => {
      return { players: playerStore.getAllPlayers() };
    });

    // Transactions
    app.get("/api/admin/transactions", async () => {
      return { transactions: playerStore.getAllTransactions() };
    });

    // Providers
    app.get("/api/admin/providers", async () => {
      return { providers: providerStore.getAll() };
    });

    app.post("/api/admin/providers", async (req, reply) => {
      const body = req.body as any;
      if (!body.name || !body.platformUrl || !body.operatorId || !body.apiKeyId || !body.apiSecret || !body.webhookSecret || !body.adminToken) {
        return reply.code(400).send({ error: "Missing required provider fields" });
      }
      const provider = providerStore.add(body);
      return { provider };
    });

    app.put("/api/admin/providers/:id", async (req, reply) => {
      const body = req.body as any;
      const id = (req.params as any).id;
      try {
        const provider = providerStore.update(id, body);
        return { provider };
      } catch (err) {
        return reply.code(404).send({ error: "Provider not found" });
      }
    });

    app.delete("/api/admin/providers/:id", async (req, reply) => {
      const id = (req.params as any).id;
      providerStore.delete(id);
      return { ok: true };
    });
  };
}
