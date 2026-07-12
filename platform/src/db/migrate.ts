import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Tiny forward-only migration runner. Applies every migrations/NNNN_*.sql not yet
 * recorded in schema_migrations, each inside its own transaction, in filename order.
 * Idempotent: re-running applies nothing new. Migration files contain no BEGIN/COMMIT
 * (this runner owns the transaction) and no schema_migrations bookkeeping.
 */
export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

function migrationsDir(): string {
  // Resolves from both src (tsx) and dist (compiled) layouts.
  const candidates = [
    path.resolve(__dirname, "../../migrations"),
    path.resolve(__dirname, "../../../migrations"),
    path.resolve(process.cwd(), "migrations")
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`migrations dir not found (tried: ${candidates.join(", ")})`);
}

export async function runMigrations(pool: Pool): Promise<MigrateResult> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  const done = new Set(
    (await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version)
  );

  const dir = migrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) {
      alreadyApplied.push(version);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      applied.push(version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${version} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { applied, alreadyApplied };
}
