import type { FastifyInstance } from 'fastify';
import '../auth/types';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { Tenants, tbl } from '../db/tenants';
import { loadKnowledge } from '../db/loadKnowledge';
import { Engine } from '../engine/engine';
import { extractPairs, recordPairs } from '../learning/collect';

const q = async (pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<RowDataPacket[]>(sql, p))[0];
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export interface LearnGroup {
  key: string; kind: 'covered' | 'topic' | 'text'; label: string; topic: string | null; intent: string | null;
  count: number; withReply: number; customers: { text: string; n: number }[]; replies: { text: string; n: number }[];
}

const top = (m: Map<string, { text: string; n: number }>, k: number) => [...m.values()].sort((a, b) => b.n - a.n).slice(0, k);

/** The "Learning" screen: what the bot collected while it only listened, grouped by what customers asked, with the reply staff gave most often. */
export function learningRoutes(app: FastifyInstance, ctx: { pool: Pool }) {
  const mayUse = (req: { user?: { role: string; merchant?: string | null } }, code: string) => req.user?.role === 'admin' || (req.user?.merchant ?? null) === code;

  app.get<{ Querystring: { merchant: string } }>('/api/admin/learning', async (req, reply) => {
    const code = String(req.query.merchant ?? ''); if (!mayUse(req, code)) return reply.code(403).send({ error: 'You cannot see this merchant.' });
    const t = await new Tenants(ctx.pool).get(code); if (!t) return reply.code(404).send({ error: 'There is no such merchant.' });
    const [m] = await q(ctx.pool, "SELECT bot_mode, DATE_FORMAT(listening_since, '%Y-%m-%dT%H:%i:%sZ') AS since, DATEDIFF(NOW(), listening_since) AS days FROM merchants WHERE code = ?", [code]);
    const T = tbl(t.db, 'learned_pairs');
    const rows = await q(ctx.pool, `SELECT customer_text, staff_text, session_key FROM ${T} ORDER BY id DESC LIMIT 20000`);
    const engine = new Engine(await loadKnowledge(ctx.pool));
    const groups = new Map<string, LearnGroup & { cm: Map<string, { text: string; n: number }>; rm: Map<string, { text: string; n: number }> }>();
    for (const r of rows) {
      const customer = String(r.customer_text), staff = r.staff_text ? String(r.staff_text) : null;
      let key = 'text:' + norm(customer), kind: LearnGroup['kind'] = 'text', label = customer, topic: string | null = null, intent: string | null = null;
      if (engine.hasMerchant(code)) {
        const a = engine.analyze(customer, code);
        if (a.small) continue;                                    // "thanks", "hi", "ok": nothing to learn from
        topic = a.topic;
        if (a.decision === 'ANSWER' && a.top?.intent) { key = 'kb:' + a.top.intent; kind = 'covered'; label = a.top.intent; intent = a.top.intent; }
        else if (a.topic) { key = 'topic:' + a.topic; kind = 'topic'; label = a.topic; }
      }
      let g = groups.get(key); if (!g) { g = { key, kind, label, topic, intent, count: 0, withReply: 0, customers: [], replies: [], cm: new Map(), rm: new Map() }; groups.set(key, g); }
      g.count++; const ck = norm(customer); const c = g.cm.get(ck) ?? { text: customer, n: 0 }; c.n++; g.cm.set(ck, c);
      if (staff) { g.withReply++; const rk = norm(staff); const x = g.rm.get(rk) ?? { text: staff, n: 0 }; x.n++; g.rm.set(rk, x); }
    }
    const list = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 40).map(({ cm, rm, ...g }) => ({ ...g, customers: top(cm, 6), replies: top(rm, 3) }));
    const [s] = await q(ctx.pool, `SELECT COUNT(*) AS pairs, COUNT(DISTINCT session_key) AS chats, SUM(staff_text IS NOT NULL) AS withReply FROM ${T}`);
    return { mode: String(m?.bot_mode ?? 'answering'), since: m?.since ?? null, days: m?.since ? Number(m.days ?? 0) : null,
      pairs: Number(s.pairs ?? 0), chats: Number(s.chats ?? 0), withReply: Number(s.withReply ?? 0), groups: list };
  });

  /** Admin only: put a merchant into listening (the bot stays silent and learns) or answering. */
  app.post<{ Params: { code: string }; Body: { mode?: string } }>('/api/admin/merchants/:code/mode', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can do this.' });
    const mode = req.body?.mode; if (mode !== 'listening' && mode !== 'answering') return reply.code(400).send({ error: 'The mode is listening or answering.' });
    const t = await new Tenants(ctx.pool).get(req.params.code); if (!t) return reply.code(404).send({ error: 'There is no such merchant.' });
    if (mode === 'listening') await ctx.pool.query('UPDATE merchants SET bot_mode = ?, listening_since = COALESCE(listening_since, NOW()) WHERE code = ?', [mode, req.params.code]);
    else await ctx.pool.query('UPDATE merchants SET bot_mode = ? WHERE code = ?', [mode, req.params.code]);
    return { ok: true, mode };
  });

  /**
   * Old conversations (an export of past chats): the same learning as listening, but from a file, so a merchant can start learning before going live.
   * The panel reads the file and sends the messages in batches; each message says which chat it belongs to and whether a customer or a person wrote it.
   */
  app.post<{ Body: { merchant?: string; messages?: { chat?: unknown; from?: unknown; text?: unknown; at?: unknown }[] } }>('/api/admin/learning/import', async (req, reply) => {
    const code = String(req.body?.merchant ?? ''); if (!mayUse(req, code)) return reply.code(403).send({ error: 'You cannot change this merchant.' });
    const t = await new Tenants(ctx.pool).get(code); if (!t) return reply.code(404).send({ error: 'There is no such merchant.' });
    const msgs = req.body?.messages; if (!Array.isArray(msgs) || !msgs.length) return reply.code(400).send({ error: 'There are no messages to import.' });
    if (msgs.length > 3000) return reply.code(400).send({ error: 'Send at most 3000 messages at a time.' });
    const chats = new Map<string, { role: string; text: string; created_at?: string }[]>();
    for (const m of msgs) {
      const chat = String(m.chat ?? '').trim().slice(0, 70), text = String(m.text ?? '').trim().slice(0, 2000);
      if (!chat || !text || (m.from !== 'customer' && m.from !== 'staff')) continue;
      const list = chats.get(chat) ?? []; list.push({ role: m.from === 'customer' ? 'user' : 'bot', text, ...(typeof m.at === 'string' && m.at ? { created_at: m.at } : {}) }); chats.set(chat, list);
    }
    let pairs = 0, withReply = 0;
    for (const [chat, history] of chats) {
      const ps = extractPairs(history, ''); pairs += ps.length; withReply += ps.filter((p) => p.staff).length;
      await recordPairs(ctx.pool, t.db, 'imp-' + chat, ps, null);
    }
    return { chats: chats.size, pairs, withReply };
  });
}
