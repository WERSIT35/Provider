import { randomUUID } from "node:crypto";
// Reuse the exact HMAC scheme the platform itself verifies — see
// platform/src/lib/security/hmac.ts and platform/src/http/auth.ts
// (operatorHmacAuth). Not reimplemented here.
import { computeSignature } from "../../../platform/src/lib/security/hmac";
import type { DemoOperatorConfig } from "../config";

export interface LobbyGame {
  id: string; // OperatorGame (entitlement) id
  game_id: string;
  game_code: string;
  title: string;
  display_name: string | null;
  thumbnail_url: string | null;
  sort_order: number;
  currency: string;
  allowed_bets: number[];
}

interface OperatorGameDto {
  id: string;
  game_id: string;
  currency: string;
  allowed_bets: number[];
  status: "enabled" | "disabled";
  display_name: string | null;
  thumbnail_url: string | null;
  sort_order: number;
  lobby_enabled: boolean;
}

interface GameDto {
  id: string;
  code: string;
  title: string;
}

/** Narrow surface used by the routes — lets tests substitute a fake without a real platform. */
export interface IPlatformClient {
  launch(playerRef: string): Promise<{ launchToken: string; launchUrl: string }>;
  listLobbyGames(): Promise<LobbyGame[]>;
}

/** Everything demo-operator needs to say to the platform, over real HTTP. */
export class PlatformClient implements IPlatformClient {
  constructor(private readonly cfg: DemoOperatorConfig) {}

  /** Sign and send a launch request with this Operator's real API credentials. */
  async launch(playerRef: string): Promise<{ launchToken: string; launchUrl: string }> {
    const body = JSON.stringify({
      game_code: this.cfg.gameCode,
      operator_player_id: playerRef,
      currency: this.cfg.currency,
      origin: this.cfg.origin
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const path = "/operator/v1/launch";
    const signature = computeSignature(this.cfg.apiSecret, { timestamp, method: "POST", path, rawBody: body });

    const res = await fetch(`${this.cfg.platformUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKeyId,
        "x-timestamp": timestamp,
        "x-nonce": randomUUID(),
        "x-signature": signature
      },
      body
    });
    const payload = (await res.json()) as { launch_token?: string; error?: { code: string; message: string } };
    if (!res.ok || !payload.launch_token) {
      throw new Error(payload.error?.code ?? "LAUNCH_FAILED");
    }
    return { launchToken: payload.launch_token, launchUrl: `${this.cfg.platformUrl}/play?lt=${payload.launch_token}` };
  }

  /** Admin-token-authenticated read of this Operator's own entitlements, filtered
   * to what should actually show in the lobby — nothing hardcoded. */
  async listLobbyGames(): Promise<LobbyGame[]> {
    const [gamesRes, catalogRes] = await Promise.all([
      this.adminGet(`/admin/v1/operator-games?operator_id=${this.cfg.operatorId}`),
      this.adminGet(`/admin/v1/games`)
    ]);
    const operatorGames = (gamesRes.operator_games as OperatorGameDto[]) ?? [];
    const catalog = new Map<string, GameDto>((catalogRes.games as GameDto[]).map((g) => [g.id, g]));

    return operatorGames
      .filter((og) => og.status === "enabled" && og.lobby_enabled)
      .map((og) => {
        const catalogGame = catalog.get(og.game_id);
        return {
          id: og.id,
          game_id: og.game_id,
          game_code: catalogGame?.code ?? "",
          title: catalogGame?.title ?? og.game_id,
          display_name: og.display_name,
          thumbnail_url: og.thumbnail_url,
          sort_order: og.sort_order,
          currency: og.currency,
          allowed_bets: og.allowed_bets
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  private async adminGet(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.cfg.platformUrl}${path}`, {
      headers: { authorization: `Bearer ${this.cfg.adminToken}` }
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = payload.error as { code?: string } | undefined;
      throw new Error(err?.code ?? "PLATFORM_ADMIN_CALL_FAILED");
    }
    return payload;
  }
}
