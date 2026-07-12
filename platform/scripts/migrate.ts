/**
 * Apply pending Postgres migrations.
 *
 *   DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run migrate
 */
import { createPool, closePool } from "../src/db/pool";
import { runMigrations } from "../src/db/migrate";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required (e.g. postgres://bananax:bananax@127.0.0.1:5432/bananax)");
    process.exit(2);
  }
  const pool = createPool(url);
  const res = await runMigrations(pool);
  // eslint-disable-next-line no-console
  console.log(
    res.applied.length
      ? `Applied: ${res.applied.join(", ")}` + (res.alreadyApplied.length ? ` (skipped ${res.alreadyApplied.length} already applied)` : "")
      : `Nothing to apply (${res.alreadyApplied.length} already applied).`
  );
  await closePool();
}

void main();
