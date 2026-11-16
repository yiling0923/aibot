import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { Tenants, tbl } from '../db/tenants';

export interface MerchantAiInfo { limit: number | null; usedMonth: number; usedToday: number; style: string }

/**
 * What a merchant allows its AI: a monthly token limit (when it is used up the bot keeps answering from the knowledge base and only the AI help stops
 * until next month) and the style rules the merchant wrote. Read from the database and kept for a minute, so a chat never waits for it.
 * A database that cannot be read means "no limit, no style": the bot is never stopped by a failure here.
 */
export class MerchantLimits {
  private cache = new Map<string, { at: number; info: MerchantAiInfo }>();
  constructor(private pool: Pool, private ttlMs = 60_000) {}
  forget(code?: string) { if (code) this.cache.delete(code); else this.cache.clear(); }

  async info(code: string): Promise<MerchantAiInfo> {
    const hit = this.cache.get(code); if (hit && Date.now() - hit.at < this.ttlMs) return hit.info;
    const info: MerchantAiInfo = { limit: null, usedMonth: 0, usedToday: 0, style: '' };
    try {
      const q = async (sql: string, p: unknown[]) => (await this.pool.query<RowDataPacket[]>(sql, p))[0];
      const [m] = await q('SELECT monthly_token_limit AS lim FROM merchants WHERE code = ?', [code]);
      info.limit = m?.lim === null || m?.lim === undefined ? null : Number(m.lim);
      const [u] = await q(`SELECT COALESCE(SUM(CASE WHEN u.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN u.input_tokens + u.output_tokens END), 0) AS month,
        COALESCE(SUM(CASE WHEN u.created_at >= CURDATE() THEN u.input_tokens + u.output_tokens END), 0) AS today
        FROM ai_usage u JOIN merchants mm ON mm.id = u.merchant_id WHERE mm.code = ?`, [code]);
      info.usedMonth = Number(u?.month ?? 0); info.usedToday = Number(u?.today ?? 0);
      const t = await new Tenants(this.pool).get(code);
      if (t) { const [s] = await q(`SELECT ai_instructions FROM ${tbl(t.db, 'settings')} WHERE id = 1`, []); info.style = String(s?.ai_instructions ?? ''); }
    } catch { /* keep what was read so far */ }
    this.cache.set(code, { at: Date.now(), info }); return info;
  }
  /** May this merchant use the AI right now? */
  async allow(code: string): Promise<boolean> { const i = await this.info(code); return i.limit === null || i.usedMonth < i.limit; }
  async style(code: string): Promise<string> { return (await this.info(code)).style; }
}
