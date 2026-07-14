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
import { buildContainer, seedBootstrapAdmin } from "../src/container";
import { buildApp } from "../src/app";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { NullPersistence, PostgresPersistence, type Persistence } from "../src/persistence/persistence";
import { hydrateContainer } from "../src/persistence/hydrate";
import { createPool, getPool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";

const PORT = Number(process.env.PORT ?? 8080);
const ADMIN_SECRET = process.env.ADMIN_TOKEN_SECRET ?? "dev-admin-secret-change-me";
// Demo tokens (player launch + admin) live long enough for a hand-driven test
// session. The printed URLs/tokens are useless if they expire before you click.
const DEMO_TTL_SECONDS = Number(process.env.DEMO_TOKEN_TTL_SECONDS ?? 3600);

const BOOTSTRAP_USER = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";
const BOOTSTRAP_PASS = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "change-me-admin";

const cfg = {
  launchSecret: process.env.LAUNCH_TOKEN_SECRET ?? "dev-launch-secret-change-me",
  sessionSecret: process.env.SESSION_TOKEN_SECRET ?? "dev-session-secret-change-me",
  adminSecret: ADMIN_SECRET,
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000,
  bootstrapAdminUsername: BOOTSTRAP_USER,
  bootstrapAdminPassword: BOOTSTRAP_PASS
};

async function main(): Promise<void> {
  // Optional Postgres durability. Re-running against an existing DB reuses the
  // already-seeded operator instead of erroring on the duplicate slug.
  let persistence: Persistence = NullPersistence;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = createPool(dbUrl);
    await runMigrations(pool);
  }

  const wallet = new SandboxWallet();
  if (dbUrl) persistence = new PostgresPersistence(getPool());
  const c = buildContainer(cfg, { wallet, persistence });
  if (dbUrl) await hydrateContainer(c, persistence);

  // Idempotent provisioning: only seed if the demo operator doesn't already exist.
  let op = c.mgmt.listOperators().find((o) => o.slug === "demo") ?? null;
  let inspectorRef: string | null = null;

  if (!op) {
    op = c.mgmt.createOperator({ name: "Demo Casino", slug: "demo" });
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
    inspectorRef = firstWinRef ?? firstRef;
  } else {
    // Reuse the persisted operator; pick an existing round for the inspector.
    const rounds = c.reporting.listRounds(op.id);
    inspectorRef = rounds.find((r) => r.total_win > 0)?.round_ref ?? rounds[0]?.round_ref ?? null;
  }

  // Persist everything the seed just created before we start serving.
  await persistence.flush();

  // Mint a fresh launch token for the player demo (the one above was consumed).
  const playerToken = c.sessions.createLaunchToken(
    {
      operator_id: op.id,
      game_code: "bananax",
      operator_player_id: "p1",
      currency: "GEL",
      origin: "casino.example.com"
    },
    DEMO_TTL_SECONDS
  );

  const providerToken = c.adminAuth.mintToken(
    {
      admin_id: "dev-admin",
      scope: "provider",
      operator_id: null,
      role: "provider_super_admin"
    },
    DEMO_TTL_SECONDS
  );
  const operatorToken = c.adminAuth.mintToken(
    {
      admin_id: "dev-op-admin",
      scope: "operator",
      operator_id: op.id,
      role: "operator_admin"
    },
    DEMO_TTL_SECONDS
  );

  // Real logins for the two consoles: seed the bootstrap provider super-admin and
  // create a demo operator (casino) admin. Both must set a new password + enroll a
  // TOTP authenticator on first sign-in.
  seedBootstrapAdmin(c);
  let operatorAdmin: { username: string; temp_password: string } | null = null;
  if (!c.adminAccounts.getByUsername("demo-operator")) {
    const created = c.adminAccounts.create(
      { username: "demo-operator", scope: "operator", operator_id: op.id, role: "operator_admin" },
      "dev-seed"
    );
    operatorAdmin = { username: created.account.username, temp_password: created.temp_password };
  }

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
      `  Provider platform · ready on ${base}`,
      "─────────────────────────────────────────────────────────────────────",
      "",
      `  Provider Control Plane (our admin):  ${base}/provider`,
      `  Operator Portal (client admin):      ${base}/admin`,
      `  Player demo (launch):                ${base}/play?lt=${playerToken}`,
      "",
      "  Sign in with username + password, then enroll an authenticator (2FA)",
      "  on first login. Seeded logins:",
      "",
      `    PROVIDER  → username: ${BOOTSTRAP_USER}   password: ${BOOTSTRAP_PASS}   (at /provider)`,
      operatorAdmin
        ? `    OPERATOR  → username: ${operatorAdmin.username}   one-time password: ${operatorAdmin.temp_password}   (at /admin)`
        : "    OPERATOR  → already seeded (reuse your existing password)",
      "",
      `  Seeded operator:     '${op.slug}' (${op.id})`,
      `  Plays:               50 × bet 5 GEL`,
      `  Sample round_ref:    ${inspectorRef ?? "(none)"}`,
      `    → paste it in the Round Inspector to see the visual playback`,
      "",
      "  Script-only admin tokens (bypass the login UI, e.g. for curl):",
      `    PROVIDER: ${providerToken}`,
      `    OPERATOR: ${operatorToken}`,
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
