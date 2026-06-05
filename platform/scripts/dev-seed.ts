/**
 * One-command dev run: starts the platform with seed data so the Admin Portal +
 * Round Inspector have something to show out of the box.
 *
 *   npx tsx scripts/dev-seed.ts
 *   # or
 *   npm run dev:seed
 *
 * It provisions an operator + an approved math config + a game assignment, plays
 * a handful of spins (and looks for a winning one so the Round Inspector has a
 * visually interesting round), then boots the HTTP server. The console prints:
 *   - the admin portal URL                     (paste a token to sign in)
 *   - a PROVIDER admin token                   (sees everything; onboarding)
 *   - an OPERATOR admin token                  (scoped to the demo operator)
 *   - a sample round_ref + the inspector deep-link
 *   - a player demo launch URL                 (open in another tab to play)
 *
 * State is in-memory; restarting the process clears it.
 */
import { buildContainer } from "../src/container";
import { buildApp } from "../src/app";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

const PORT = Number(process.env.PORT ?? 8080);
const ADMIN_SECRET = process.env.ADMIN_TOKEN_SECRET ?? "dev-admin-secret-change-me";

const cfg = {
  launchSecret: process.env.LAUNCH_TOKEN_SECRET ?? "dev-launch-secret-change-me",
  sessionSecret: process.env.SESSION_TOKEN_SECRET ?? "dev-session-secret-change-me",
  adminSecret: ADMIN_SECRET,
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000
};

async function main(): Promise<void> {
  const wallet = new SandboxWallet();
  const c = buildContainer(cfg, { wallet });

  // Provision: operator → domain → approved math config → game assignment.
  const op = c.mgmt.createOperator({ name: "Demo Casino", slug: "demo" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let mc = c.mgmt.createMathConfig({
    game_id: game.id,
    version: "3.0.0",
    rtp_profile_key: "bananax",
    theoretical_rtp: 96.38,
    config_hash: "sha256:demo"
  });
  mc = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(mc.id).id, "math-lead");
  c.mgmt.assignGame({
    operator_id: op.id,
    game_id: game.id,
    math_config_id: mc.id,
    currency: "GEL",
    allowed_bets: [1, 5, 10, 50, 500]
  });
  wallet.setBalance("p1", "GEL", 100_000);

  // Open a session and play a handful of spins so the ledger has rows.
  const launchToken = c.sessions.createLaunchToken({
    operator_id: op.id,
    game_code: "bananax",
    operator_player_id: "p1",
    currency: "GEL",
    origin: "casino.example.com"
  });
  const session = c.sessions.initSession(launchToken);

  let firstWinRef: string | null = null;
  let firstRef: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const out = await c.orchestrator.spin(session.id, { bet_amount: 5, idempotency_key: `seed-${i}` });
    if (i === 0) firstRef = out.round_ref;
    if (!firstWinRef && out.total_win > 0) firstWinRef = out.round_ref;
  }
  const inspectorRef = firstWinRef ?? firstRef;

  // Mint a fresh launch token for the player demo (the one above was consumed).
  const playerToken = c.sessions.createLaunchToken({
    operator_id: op.id,
    game_code: "bananax",
    operator_player_id: "p1",
    currency: "GEL",
    origin: "casino.example.com"
  });

  const providerToken = c.adminAuth.mintToken({
    admin_id: "dev-admin",
    scope: "provider",
    operator_id: null,
    role: "provider_super_admin"
  });
  const operatorToken = c.adminAuth.mintToken({
    admin_id: "dev-op-admin",
    scope: "operator",
    operator_id: op.id,
    role: "operator_admin"
  });

  const app = buildApp({
    logger: createLogger({ level: "info", pretty: true, env: "local" }),
    container: c
  });
  await app.listen({ host: "127.0.0.1", port: PORT });

  const base = `http://127.0.0.1:${PORT}`;
  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "─────────────────────────────────────────────────────────────────────",
      `  Banana X platform · ready on ${base}`,
      "─────────────────────────────────────────────────────────────────────",
      "",
      `  Admin Portal:        ${base}/admin`,
      `  Player demo (launch): ${base}/play?lt=${playerToken}`,
      "",
      `  Seeded operator:     '${op.slug}' (${op.id})`,
      `  Plays:               50 × bet 5 GEL`,
      `  Sample round_ref:    ${inspectorRef ?? "(none)"}`,
      `    → paste it in the Round Inspector to see the visual playback`,
      "",
      "  PROVIDER admin token (see everything + onboard):",
      `    ${providerToken}`,
      "",
      "  OPERATOR admin token (scoped to the demo operator):",
      `    ${operatorToken}`,
      "",
      "  Quick curl:",
      `    curl ${base}/admin/v1/rounds/${inspectorRef ?? "<round_ref>"} \\`,
      `      -H "Authorization: Bearer <PROVIDER token>"`,
      "",
      "  Ctrl+C to stop.",
      "─────────────────────────────────────────────────────────────────────"
    ].join("\n")
  );
}

void main();
