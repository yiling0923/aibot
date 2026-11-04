import pg from 'pg';
import { config } from '../config';

let pool: pg.Pool | null = null;
export function getPool(url = config.databaseUrl): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 10 });
  return pool;
}
export async function closePool() { if (pool) { await pool.end(); pool = null; } }
