import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from './pool';
import { Tenants, tbl } from './tenants';

/**
 * Deletes the conversations older than each merchant's retention (days). A merchant with no retention (empty or 0) keeps everything.
 * The messages and decisions of a chat go with it. The connector's chat memory and request log older than the same time go too.
 * Returns how many chats were deleted per merchant. A merchant database that fails is skipped and the next one still runs.
 */
export async function purgeOldChats(pool: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const [rows] = await pool.query<RowDataPacket[]>("SELECT code, retention_days AS d FROM merchants WHERE status = 'active' AND retention_days IS NOT NULL AND retention_days > 0");
  const tenants = new Tenants(pool);
  for (const r of rows) {
    try {
      const t = await tenants.get(r.code); if (!t) continue; const days = Number(r.d);
      const [res] = await pool.query<import('mysql2/promise').ResultSetHeader>(`DELETE FROM ${tbl(t.db, 'chat_sessions')} WHERE started_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]);
      await pool.query(`DELETE FROM ${tbl(t.db, 'bot_sessions')} WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]).catch(() => undefined);
      await pool.query(`DELETE FROM ${tbl(t.db, 'bot_requests')} WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]).catch(() => undefined);
      out[r.code] = res.affectedRows;
    } catch (e) { console.warn(`Retention sweep skipped ${r.code}:`, (e as Error).message); }
  }
  return out;
}
