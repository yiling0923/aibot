import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import '../auth/types';
import { Tenants, tbl } from '../db/tenants';
import { parseLangs } from '../db/loadKnowledge';
import { LANGS } from '../engine/types';
import type { MerchantLimits } from '../ai/limits';

export interface BasicsCtx { pool: Pool; reloadBot: () => Promise<unknown>; limits: MerchantLimits }
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

/**
 * The basics of one merchant: name, domain, monthly AI token limit and the languages the bot answers in (admin only to change),
 * plus the numbers of today for the tiles on the Merchant settings page (the merchant's own staff may read them).
 */
export function basicsRoutes(app: FastifyInstance, ctx: BasicsCtx) {
  const { pool } = ctx; const P = '/api/admin/merchants/:code/basics';
  const may = (req: { user?: { role: string; merchant?: string | null } }, code: string) => req.user?.role === 'admin' || req.user?.merchant === code;

  app.get<{ Params: { code: string } }>(P, async (req, reply) => {
    const { code } = req.params; if (!may(req, code)) return reply.code(403).send({ error: 'You can only work with your own merchant.' });
    const [m] = await q(pool, "SELECT code, name, default_language, domain, monthly_token_limit, languages, retention_days, currency FROM merchants WHERE code = ? AND status = 'active'", [code]);
    const t = m ? await new Tenants(pool).get(code) : null; if (!m || !t) return reply.code(404).send({ error: 'There is no such merchant.' });
    ctx.limits.forget(code); const info = await ctx.limits.info(code);
    const [n] = await q(pool, `SELECT COUNT(*) AS n FROM ${tbl(t.db, 'kb_entries')}`);
    let questions = 0, conf: number | null = null;
    try {
      const [d] = await q(pool, `SELECT SUM(decision <> 'HANDED') AS n, AVG(CASE WHEN decision = 'ANSWER' THEN confidence END) AS c FROM ${tbl(t.db, 'bot_decisions')} WHERE created_at >= CURDATE()`);
      questions = Number(d?.n ?? 0); conf = d?.c === null || d?.c === undefined ? null : Number(d.c);
    } catch { /* an older merchant database: the tiles show zero */ }
    return {
      name: m.name, domain: m.domain ?? '', defaultLanguage: m.default_language, languages: parseLangs(m.languages) ?? [...LANGS],
      retentionDays: Number(m.retention_days ?? 0), currency: String(m.currency ?? 'RM'), monthlyTokenLimit: info.limit, tokensMonth: info.usedMonth, tokensToday: info.usedToday,
      entries: Number(n?.n ?? 0), questionsToday: questions, avgConfidence: conf,
    };
  });

  app.post<{ Params: { code: string }; Body: { name?: unknown; domain?: unknown; monthlyTokenLimit?: unknown; languages?: unknown; retentionDays?: unknown; currency?: unknown } }>(P, async (req, reply) => {
    const { code } = req.params;
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can do this.' });
    const [m] = await q(pool, "SELECT id, default_language FROM merchants WHERE code = ? AND status = 'active'", [code]); if (!m) return reply.code(404).send({ error: 'There is no such merchant.' });
    const b = req.body ?? {}; const sets: string[] = []; const vals: unknown[] = [];
    const bad = (error: string) => reply.code(400).send({ error });
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n || n.length > 100) return bad('Give the merchant a name (up to 100 characters).'); sets.push('name = ?'); vals.push(n); }
    if (b.domain !== undefined) {
      const raw = String(b.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
      if (raw && (raw.length > 200 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(:\d+)?(\/\S*)?$/.test(raw))) return bad('That does not look like a domain. Write it like merchant-domain.com, or leave it empty.');
      sets.push('domain = ?'); vals.push(raw || null);
    }
    if (b.monthlyTokenLimit !== undefined) {
      if (b.monthlyTokenLimit === null || b.monthlyTokenLimit === '') { sets.push('monthly_token_limit = ?'); vals.push(null); }
      else { const v = Number(b.monthlyTokenLimit); if (!Number.isInteger(v) || v < 0 || v > 1e12) return bad('The token limit must be a whole number, or empty for no limit.'); sets.push('monthly_token_limit = ?'); vals.push(v); }
    }
    if (b.languages !== undefined) {
      const l = Array.isArray(b.languages) ? b.languages.map(String).filter((x) => (LANGS as readonly string[]).includes(x)) : [];
      if (!l.length) return bad('Switch on at least one language.');
      if (!l.includes(m.default_language)) return bad('The main language of this merchant must stay on.');
      sets.push('languages = ?'); vals.push(l.length === LANGS.length ? null : LANGS.filter((x) => l.includes(x)).join(','));
    }
    if (b.retentionDays !== undefined) {
      const v = b.retentionDays === null || b.retentionDays === '' ? 0 : Number(b.retentionDays);
      if (!Number.isInteger(v) || v < 0 || v > 3650) return bad('Keep conversations for a whole number of days from 1 to 3650, or 0 to keep them for ever.');
      sets.push('retention_days = ?'); vals.push(v === 0 ? null : v);
    }
    if (b.currency !== undefined) {
      const c = String(b.currency ?? '').trim();
      if (!c || c.length > 8 || /[\d\s<>"']/.test(c)) return bad('Write the money sign without spaces or digits, up to 8 characters, for example RM, SGD, $ or ฿.');
      sets.push('currency = ?'); vals.push(c);
    }
    if (!sets.length) return bad('Nothing to save.');
    await pool.query(`UPDATE merchants SET ${sets.join(', ')} WHERE id = ?`, [...vals, m.id]);
    ctx.limits.forget(code); await ctx.reloadBot();
    return { saved: true };
  });
}
