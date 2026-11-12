import { createHash, randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';

/** The key a merchant's LiveChat uses to call the bot. Only its hash is stored; the key itself is shown once, when it is made. */
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

export interface KeyInfo { id: number; prefix: string; label: string | null; createdBy: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }

/** Makes a new key for a merchant. With `replace`, every earlier key of that merchant stops working at once (the "replace the key" action). */
export async function issueKey(pool: Pool, merchantCode: string, opts: { createdBy?: string; label?: string; replace?: boolean } = {}): Promise<{ key: string; prefix: string }> {
  const [m] = await q(pool, "SELECT id FROM merchants WHERE code = ? AND status = 'active'", [merchantCode]);
  if (!m) throw new Error(`There is no merchant ${merchantCode}.`);
  const key = 'aib_' + randomBytes(24).toString('base64url');
  const prefix = key.slice(0, 8);
  if (opts.replace) await pool.query('UPDATE bot_api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE merchant_id = ? AND revoked_at IS NULL', [m.id]);
  await pool.query('INSERT INTO bot_api_keys(merchant_id, key_prefix, key_hash, label, created_by) VALUES(?,?,?,?,?)', [m.id, prefix, hash(key), opts.label ?? null, opts.createdBy ?? null]);
  return { key, prefix };
}

export async function listKeys(pool: Pool, merchantCode: string): Promise<KeyInfo[]> {
  const rows = await q(pool, `SELECT k.id, k.key_prefix, k.label, k.created_by, k.created_at, k.last_used_at, k.revoked_at FROM bot_api_keys k JOIN merchants m ON m.id = k.merchant_id WHERE m.code = ? ORDER BY k.id DESC`, [merchantCode]);
  return rows.map((r) => ({ id: Number(r.id), prefix: r.key_prefix, label: r.label, createdBy: r.created_by, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at }));
}

/** Stops every key of a merchant. */
export async function revokeKeys(pool: Pool, merchantCode: string): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>('UPDATE bot_api_keys k JOIN merchants m ON m.id = k.merchant_id SET k.revoked_at = CURRENT_TIMESTAMP WHERE m.code = ? AND k.revoked_at IS NULL', [merchantCode]);
  return r.affectedRows;
}

/** The merchant a key belongs to, or null (unknown key, revoked key, or a merchant that is not active). */
export async function resolveKey(pool: Pool, authorization: string | undefined): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? ''); if (!m) return null;
  const [r] = await q(pool, `SELECT k.id, k.last_used_at, mer.code FROM bot_api_keys k JOIN merchants mer ON mer.id = k.merchant_id
    WHERE k.key_hash = ? AND k.revoked_at IS NULL AND mer.status = 'active'`, [hash(m[1])]);
  if (!r) return null;
  if (!r.last_used_at || Date.now() - new Date(r.last_used_at).getTime() > 60_000) void pool.query('UPDATE bot_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [r.id]).catch(() => undefined);
  return r.code as string;
}
