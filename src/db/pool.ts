import mysql from 'mysql2/promise';
import { config } from '../config';

export type Pool = mysql.Pool;

/** One shared connection pool. Decimals come back as numbers; several statements per query are allowed (used by migrations). */
export function createPool(url = config.databaseUrl, max = 10): Pool {
  return mysql.createPool({ uri: url, connectionLimit: max, decimalNumbers: true, multipleStatements: true, charset: 'utf8mb4', timezone: 'Z' });
}

let pool: Pool | null = null;
export function getPool(url = config.databaseUrl): Pool {
  if (!pool) pool = createPool(url);
  return pool;
}
export async function closePool() { if (pool) { await pool.end(); pool = null; } }

/** MySQL returns JSON columns already parsed; MariaDB returns text. This accepts both. */
export function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}
