import { Pool, types } from "pg";

/**
 * Postgres connection pool + result-type coercion so DB rows come back in the exact
 * shapes the in-memory stores already use:
 *   • numeric (OID 1700) → JS number  (node-pg returns strings by default)
 *   • int8/bigint (OID 20) → JS number (safe for our seq/counter scale)
 *   • timestamptz/timestamp → ISO-8601 string (the app stores created_at as strings)
 * jsonb is already parsed to JS objects by node-pg.
 */
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8
types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString())); // timestamptz
types.setTypeParser(1114, (v) => (v === null ? null : new Date(v + "Z").toISOString())); // timestamp

let pool: Pool | null = null;

/** Lazily create the shared pool from a connection string. */
export function createPool(connectionString: string): Pool {
  if (!pool) {
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error("DB pool not initialized — call createPool(DATABASE_URL) first");
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
