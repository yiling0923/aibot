import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { decryptSecret, encryptSecret, last4 } from '../secrets';

export type Provider = 'anthropic' | 'openai';
export const PROVIDERS: Provider[] = ['anthropic', 'openai'];
export interface AiKeyInfo { provider: Provider; configured: boolean; last4: string | null; updatedAt: Date | null; updatedBy: string | null }

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

/** The AI keys each merchant saved in the panel. They are stored encrypted and only read back inside the server. */
export class MerchantAiKeys {
  /** Does any merchant have its own key? (the AI service uses this to know a merchant might be able to use AI) */
  anyHas: Record<Provider, boolean> = { anthropic: false, openai: false };
  private cache = new Map<string, { at: number; keys: Partial<Record<Provider, string>> }>();
  constructor(private pool: Pool, private ttlMs = 60_000) {}

  async refresh(): Promise<void> {
    try {
      const rows = await q(this.pool, 'SELECT DISTINCT provider FROM merchant_ai_keys');
      this.anyHas = { anthropic: rows.some((r) => r.provider === 'anthropic'), openai: rows.some((r) => r.provider === 'openai') };
    } catch { /* the table does not exist before the first migration: no merchant keys */ }
  }

  async list(code: string): Promise<AiKeyInfo[]> {
    const rows = await q(this.pool, 'SELECT k.provider, k.key_last4, k.updated_at, k.updated_by FROM merchant_ai_keys k JOIN merchants m ON m.id = k.merchant_id WHERE m.code = ?', [code]);
    return PROVIDERS.map((provider) => {
      const r = rows.find((x) => x.provider === provider);
      return { provider, configured: !!r, last4: r?.key_last4 ?? null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
    });
  }

  async set(code: string, provider: Provider, key: string, by: string): Promise<void> {
    const [m] = await q(this.pool, "SELECT id FROM merchants WHERE code = ? AND status = 'active'", [code]);
    if (!m) throw new Error(`There is no merchant ${code}.`);
    await this.pool.query(
      'INSERT INTO merchant_ai_keys(merchant_id, provider, key_encrypted, key_last4, updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE key_encrypted = VALUES(key_encrypted), key_last4 = VALUES(key_last4), updated_by = VALUES(updated_by)',
      [m.id, provider, encryptSecret(key), last4(key), by]);
    this.cache.delete(code); await this.refresh();
  }

  async clear(code: string, provider: Provider): Promise<boolean> {
    const [r] = await this.pool.query<import('mysql2/promise').ResultSetHeader[]>('DELETE k FROM merchant_ai_keys k JOIN merchants m ON m.id = k.merchant_id WHERE m.code = ? AND k.provider = ?', [code, provider]) as unknown as [{ affectedRows: number }];
    this.cache.delete(code); await this.refresh();
    return r.affectedRows > 0;
  }

  /** The merchant's own keys, decrypted (kept in memory for a minute). A key that cannot be decrypted is treated as not set. */
  async resolve(code: string): Promise<Partial<Record<Provider, string>>> {
    const hit = this.cache.get(code);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.keys;
    const keys: Partial<Record<Provider, string>> = {};
    try {
      const rows = await q(this.pool, 'SELECT k.provider, k.key_encrypted FROM merchant_ai_keys k JOIN merchants m ON m.id = k.merchant_id WHERE m.code = ?', [code]);
      for (const r of rows) { const plain = decryptSecret(r.key_encrypted); if (plain && (r.provider === 'anthropic' || r.provider === 'openai')) keys[r.provider as Provider] = plain; }
    } catch { /* no table yet */ }
    this.cache.set(code, { at: Date.now(), keys });
    return keys;
  }
}
