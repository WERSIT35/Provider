import { randomUUID } from "node:crypto";
import { computeSignature } from "../../../platform/src/lib/security/hmac";
import type { ProviderConfig } from "../store/provider-store";

export interface LobbyGame {
  id: string;
  provider_id: string; // Added to know which provider to launch this game on
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

export interface IPlatformClient {
  launch(playerRef: string, gameCode: string): Promise<{ launchToken: string; launchUrl: string }>;
  listLobbyGames(): Promise<LobbyGame[]>;
}

export class PlatformClient implements IPlatformClient {
  constructor(
    private readonly provider: ProviderConfig,
    private readonly globalConfig: { currency: string; origin: string }
  ) {}

  async launch(playerRef: string, gameCode: string): Promise<{ launchToken: string; launchUrl: string }> {
    const body = JSON.stringify({
      game_code: gameCode,
      operator_player_id: playerRef,
      currency: this.globalConfig.currency,
      origin: this.globalConfig.origin
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const path = "/operator/v1/launch";
    const signature = computeSignature(this.provider.apiSecret, { timestamp, method: "POST", path, rawBody: body });

    const res = await fetch(`${this.provider.platformUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.provider.apiKeyId,
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
    return { launchToken: payload.launch_token, launchUrl: `${this.provider.platformUrl}/play?lt=${payload.launch_token}` };
  }

  async listLobbyGames(): Promise<LobbyGame[]> {
    const [gamesRes, catalogRes] = await Promise.all([
      this.adminGet(`/admin/v1/operator-games?operator_id=${this.provider.operatorId}`),
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
          provider_id: this.provider.id,
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
    const res = await fetch(`${this.provider.platformUrl}${path}`, {
      headers: { authorization: `Bearer ${this.provider.adminToken}` }
    });
    const payload = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = payload.error as { code?: string } | undefined;
      throw new Error(err?.code ?? "PLATFORM_ADMIN_CALL_FAILED");
    }
    return payload;
  }
}
