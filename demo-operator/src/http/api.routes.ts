import type { FastifyPluginAsync } from "fastify";
import { hashPassword, verifyPassword } from "../../../platform/src/lib/security/password";
import { issuePlayerToken } from "../lib/player-session";
import { playerBearerAuth } from "./player-auth";
import type { PlayerStore } from "../store/player-store";
import { PlatformClient } from "../lib/platform-client";
import type { ProviderStore } from "../store/provider-store";
import type { DemoOperatorConfig } from "../config";

interface RegisterBody {
  email?: string;
  password?: string;
}

function publicPlayer(p: { id: string; email: string; balance: number; createdAt: string }): object {
  return { id: p.id, email: p.email, balance: p.balance, createdAt: p.createdAt };
}

export default function apiRoutes(store: PlayerStore, providerStore: ProviderStore, cfg: DemoOperatorConfig, platformFactory: (p: any, c: any) => any): FastifyPluginAsync {
  return async (app) => {
    const bearer = playerBearerAuth(cfg);

    app.post("/api/register", async (req, reply) => {
      const body = (req.body ?? {}) as RegisterBody;
      const email = body.email?.trim().toLowerCase();
      if (!email || !email.includes("@") || !body.password || body.password.length < 8) {
        return reply.code(422).send({ error: { code: "VALIDATION", message: "valid email + password (8+ chars) required" } });
      }
      if (store.findByEmail(email)) {
        return reply.code(409).send({ error: { code: "EMAIL_TAKEN", message: "an account with that email already exists" } });
      }
      const player = store.register(email, hashPassword(body.password), cfg.startingBalance);
      const token = issuePlayerToken(cfg.sessionSecret, player.id);
      return { token, player: publicPlayer(player), currency: cfg.currency };
    });

    app.post("/api/login", async (req, reply) => {
      const body = (req.body ?? {}) as RegisterBody;
      const email = body.email?.trim().toLowerCase();
      const player = email ? store.findByEmail(email) : null;
      if (!player || !body.password || !verifyPassword(body.password, player.passwordHash)) {
        return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "wrong email or password" } });
      }
      const token = issuePlayerToken(cfg.sessionSecret, player.id);
      return { token, player: publicPlayer(player), currency: cfg.currency };
    });

    app.get("/api/me", { preHandler: bearer }, async (req, reply) => {
      const player = store.getById(req.playerId as string);
      if (!player) return reply.code(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "account no longer exists" } });
      return { player: publicPlayer(player), currency: cfg.currency };
    });

    app.get("/api/lobby", async (req, reply) => {
      try {
        const providers = providerStore.getAll();
        const allGames = [];
        for (const p of providers) {
          try {
            const client = platformFactory(p, cfg);
            const games = await client.listLobbyGames();
            allGames.push(...games);
          } catch (err) {
            req.log.warn({ err, providerId: p.id }, "provider_lobby_fetch_failed");
          }
        }
        return { games: allGames, currency: cfg.currency };
      } catch (err) {
        req.log.warn({ err }, "lobby_fetch_failed");
        return reply.code(502).send({ error: { code: "LOBBY_UNAVAILABLE", message: "could not aggregate lobby" } });
      }
    });

    app.post<{ Params: { providerId: string; gameCode: string } }>("/api/play/:providerId/:gameCode", { preHandler: bearer }, async (req, reply) => {
      const player = store.getById(req.playerId as string);
      if (!player) return reply.code(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "account no longer exists" } });
      
      const provider = providerStore.getById(req.params.providerId);
      if (!provider) return reply.code(404).send({ error: { code: "PROVIDER_NOT_FOUND", message: "provider not found" } });

      try {
        const client = platformFactory(provider, cfg);
        const { launchUrl } = await client.launch(player.id, req.params.gameCode);
        return { launch_url: launchUrl };
      } catch (err) {
        req.log.warn({ err }, "launch_failed");
        return reply.code(502).send({ error: { code: "LAUNCH_FAILED", message: "could not launch the game" } });
      }
    });

    app.get("/api/account", { preHandler: bearer }, async (req, reply) => {
      const player = store.getById(req.playerId as string);
      if (!player) return reply.code(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "account no longer exists" } });
      return {
        player: publicPlayer(player),
        currency: cfg.currency,
        transactions: store.transactionsFor(player.id)
      };
    });
  };
}
