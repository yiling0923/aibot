import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import '../auth/types';
import { Tenants, tbl } from '../db/tenants';
import type { Bot } from '../bot/responder';
import { cleanPairs, parsePairs } from '../study/clean';
import { gaps, measure, type StudyPair } from '../study/measure';

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const MAX_TEXT = 30 * 1024 * 1024, MAX_PAIRS = 100_000;

/**
 * Study real chats (step 5 of the plan): load customer question -> staff reply pairs, remove personal details and filler,
 * hold back about 20% as a test set, measure the published bot on that test set, and list the answers that are missing.
 */
export function studyRoutes(app: FastifyInstance, ctx: { pool: Pool; getBot: () => Promise<Bot> }) {
  const { pool } = ctx; const P = '/api/admin/merchants/:code/study';
  const gate = async (req: { user?: { role: string; merchant?: string | null }; params: { code: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const code = req.params.code;
    if (req.user?.role !== 'admin' && req.user?.merchant !== code) { reply.code(403).send({ error: 'You can only work with your own merchant.' }); return null; }
    const t = await new Tenants(pool).get(code); if (!t) { reply.code(404).send({ error: 'There is no such merchant.' }); return null; }
    return t;
  };
  const load = async (db: string): Promise<StudyPair[]> => (await q(pool, `SELECT id, question, reply, split FROM ${tbl(db, 'study_pairs')} ORDER BY id`)).map((r) => ({ id: Number(r.id), question: String(r.question), reply: String(r.reply), split: r.split === 'test' ? 'test' : 'learn' }));

  app.get<{ Params: { code: string } }>(P, async (req, reply) => {
    const t = await gate(req, reply); if (!t) return;
    const [n] = await q(pool, `SELECT COUNT(*) AS total, SUM(split = 'test') AS test, MAX(created_at) AS last FROM ${tbl(t.db, 'study_pairs')}`);
    const total = Number(n?.total ?? 0), test = Number(n?.test ?? 0);
    return { total, learn: total - test, test, lastLoaded: n?.last ?? null };
  });

  /** Reads the text (CSV or tab separated, with a question and a reply column), cleans it and saves what is left. Pairs already saved are skipped. */
  app.post<{ Params: { code: string }; Body: { text?: unknown; replace?: unknown } }>(`${P}/import`, { bodyLimit: MAX_TEXT + 1024 }, async (req, reply) => {
    const t = await gate(req, reply); if (!t) return;
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) return reply.code(400).send({ error: 'Paste or choose the file first.' });
    if (text.length > MAX_TEXT) return reply.code(400).send({ error: 'The file is too big (the most is 30 MB). Export a shorter period.' });
    const parsed = parsePairs(text); if (parsed.error) return reply.code(400).send({ error: parsed.error });
    if (parsed.pairs.length > MAX_PAIRS) return reply.code(400).send({ error: `Too many rows (the most is ${MAX_PAIRS.toLocaleString()}). Export a shorter period.` });
    const { kept, stats } = cleanPairs(parsed.pairs);
    if (req.body?.replace === true) await pool.query(`DELETE FROM ${tbl(t.db, 'study_pairs')}`);
    let added = 0;
    for (let i = 0; i < kept.length; i += 500) {
      const chunk = kept.slice(i, i + 500);
      const [r] = await pool.query(`INSERT IGNORE INTO ${tbl(t.db, 'study_pairs')}(pair_hash, question, reply, split) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')}`, chunk.flatMap((c) => [c.hash, c.pair.question, c.pair.reply, c.split]));
      added += Number((r as { affectedRows?: number }).affectedRows ?? 0);
    }
    return { ...stats, added, alreadySaved: kept.length - added };
  });

  /** Measures the published bot on the held-back test pairs, and lists what the bot cannot answer yet (from the other pairs). */
  app.post<{ Params: { code: string } }>(`${P}/measure`, async (req, reply) => {
    const t = await gate(req, reply); if (!t) return;
    const pairs = await load(t.db); const bot = await ctx.getBot();
    if (!bot.engine.hasMerchant(req.params.code)) return reply.code(404).send({ error: 'The bot has no published knowledge for this merchant yet.' });
    return { ...measure(bot.engine, req.params.code, pairs), gaps: gaps(bot.engine, req.params.code, pairs) };
  });

  app.post<{ Params: { code: string } }>(`${P}/clear`, async (req, reply) => {
    const t = await gate(req, reply); if (!t) return;
    const [r] = await pool.query(`DELETE FROM ${tbl(t.db, 'study_pairs')}`);
    return { removed: Number((r as { affectedRows?: number }).affectedRows ?? 0) };
  });
}
