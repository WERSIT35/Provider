import type { IPlatformClient, LobbyGame } from "../../src/lib/platform-client";

/** Test double for unit tests that don't need a real running platform. */
export class FakePlatformClient implements IPlatformClient {
  public launchCalls: string[] = [];
  public games: LobbyGame[] = [
    {
      id: "og_1",
      game_id: "game_1",
      game_code: "bananax",
      title: "Banana X",
      display_name: "Lucky Bananas",
      thumbnail_url: null,
      sort_order: 0,
      currency: "GEL",
      allowed_bets: [1, 5, 10]
    }
  ];

  async launch(playerRef: string): Promise<{ launchToken: string; launchUrl: string }> {
    this.launchCalls.push(playerRef);
    return { launchToken: `lt_${playerRef}`, launchUrl: `http://platform.local/play?lt=lt_${playerRef}` };
  }

  async listLobbyGames(): Promise<LobbyGame[]> {
    return this.games;
  }
}

export function testConfig(overrides: Partial<import("../../src/config").DemoOperatorConfig> = {}): import("../../src/config").DemoOperatorConfig {
  return {
    port: 0,
    platformUrl: "http://platform.local",
    operatorId: "op_test",
    apiKeyId: "ak_test",
    apiSecret: "secret_test",
    webhookSecret: "webhook_secret_test",
    adminToken: "admin_token_test",
    origin: "demo-operator.local",
    gameCode: "bananax",
    currency: "GEL",
    sessionSecret: "session_secret_test",
    startingBalance: 1000,
    ...overrides
  };
}
