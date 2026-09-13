import { loadConfig } from "./config";
import { buildApp } from "./app";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ config });
  await app.listen({ host: "127.0.0.1", port: config.port });

  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "─────────────────────────────────────────────────────────────────────",
      `  Demo Operator site · ready on http://127.0.0.1:${config.port}`,
      "─────────────────────────────────────────────────────────────────────",
      "",
      `  Platform:          ${config.platformUrl}`,
      `  Operator id:       ${config.operatorId}`,
      `  Game:              ${config.gameCode} (${config.currency})`,
      `  Wallet webhook at: http://127.0.0.1:${config.port}/wallet/*`,
      "",
      "  Open the site, register, and play — every spin's bet/win moves your",
      "  REAL demo balance here via the signed wallet webhook.",
      "─────────────────────────────────────────────────────────────────────"
    ].join("\n")
  );
}

void main();
