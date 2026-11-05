import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { Engine } from '../engine/engine';
import { Bot } from '../bot/responder';
import { loadKnowledge } from '../db/loadKnowledge';
import '../auth/types';
import { effectiveSnapshot, scopeSnapshot } from './scope';
import type { SessionUser } from '../auth/session';
import { knowledgeFromSnapshot, readMerchants, readSnapshot, writeSnapshot, type MerchantMeta, type Snapshot } from './snapshot';

export interface AdminCtx { pool: Pool; reloadBot: () => Promise<Bot>; drafts: Map<string, Bot> }

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

const ago = (d: Date) => {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`;
};

export async function ensureVersion(pool: Pool) {
  const [r] = await q(pool, 'SELECT COALESCE(MAX(version), 0) AS v FROM kb_versions');
  if (Number(r.v) === 0) {
    await pool.query('INSERT INTO kb_versions(version, actor, summary, snapshot) VALUES(1, ?, ?, ?)', ['system', 'Template data loaded', JSON.stringify(await readSnapshot(pool))]);
    return 1;
  }
  return Number(r.v);
}

/** Runs every sample message of every merchant through the engine built from this knowledge. */
export async function runTests(pool: Pool, engine: Engine) {
  const cases = await q(pool, 'SELECT ec.message, ec.language, ec.expected_decision, ec.expected_intent, m.code AS merchant FROM eval_cases ec JOIN merchants m ON m.id = ec.merchant_id ORDER BY ec.id');
  return cases.filter((c) => engine.hasMerchant(c.merchant)).map((c) => {
    const r = engine.analyze(c.message, c.merchant, 0);
    const got = r.decision, gotIntent = got === 'ANSWER' ? r.top.intent : null;
    const ok = got === c.expected_decision && (c.expected_decision !== 'ANSWER' || gotIntent === c.expected_intent);
    return { merchant: c.merchant, message: c.message, language: c.language, expected: c.expected_decision, expIntent: c.expected_intent, got, gotIntent, ok };
  });
}

/** The merchants a person may work with: all of them for an admin, only their own for merchant staff. */
async function merchantsFor(pool: Pool, user: SessionUser): Promise<MerchantMeta[]> {
  const all = await readMerchants(pool);
  return user.role === 'admin' ? all : all.filter((m) => m.code === user.merchant);
}

async function engineFor(pool: Pool, snap: Snapshot, includeDrafts: boolean, merchants: MerchantMeta[]) {
  const known = await loadKnowledge(pool);
  const limits = Object.fromEntries(known.merchants.map((m) => [m.code, m.limits]));
  return new Engine(knowledgeFromSnapshot(snap, merchants, limits, includeDrafts));
}

const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'You can only work with your own merchant.' });

export function adminRoutes(app: FastifyInstance, ctx: AdminCtx) {
  const { pool } = ctx;
  const A = '/api/admin';
  /** Staff may only ask about their own merchant. */
  const mayUse = (req: FastifyRequest, merchant: string | undefined) => req.user!.role === 'admin' || req.user!.merchant === merchant;

  app.get(`${A}/state`, async (req) => {
    const user = req.user!;
    const ver = await ensureVersion(pool);
    const history = (await q(pool, 'SELECT version, actor, summary, created_at FROM kb_versions ORDER BY version DESC LIMIT 50'))
      .map((h) => [`v${h.version}`, h.actor, h.summary, ago(h.created_at)]);
    return { ver, merchants: await merchantsFor(pool, user), snapshot: scopeSnapshot(user, await readSnapshot(pool)), history,
      user: { username: user.username, role: user.role, merchant: user.merchant } };
  });

  app.post<{ Body: { snapshot: Snapshot; includeDrafts?: boolean } }>(`${A}/tests`, async (req) => {
    const user = req.user!;
    const snap = effectiveSnapshot(user, await readSnapshot(pool), req.body.snapshot);
    const all = await runTests(pool, await engineFor(pool, snap, !!req.body.includeDrafts, await readMerchants(pool)));
    const results = user.role === 'admin' ? all : all.filter((r) => r.merchant === user.merchant);
    return { results, pass: results.filter((r) => r.ok).length, total: results.length };
  });

  app.post<{ Body: { snapshot: Snapshot; changes: string[] } }>(`${A}/publish`, async (req, reply) => {
    const user = req.user!;
    const { snapshot, changes = [] } = req.body ?? ({} as never);
    if (!snapshot?.kb) return reply.code(400).send({ error: 'snapshot is required' });
    const snap = effectiveSnapshot(user, await readSnapshot(pool), snapshot);
    const all = await runTests(pool, await engineFor(pool, snap, false, await readMerchants(pool)));
    const tests = user.role === 'admin' ? all : all.filter((r) => r.merchant === user.merchant);
    await writeSnapshot(pool, snap);
    const ver = (await ensureVersion(pool)) + 1;
    const summary = `${changes.length} change${changes.length === 1 ? '' : 's'} published: ${changes.slice(0, 2).join('; ')}${changes.length > 2 ? '…' : ''}`.slice(0, 500);
    await pool.query('INSERT INTO kb_versions(version, actor, summary, snapshot) VALUES(?,?,?,?)', [ver, user.username, summary, JSON.stringify(await readSnapshot(pool))]);
    await ctx.reloadBot();
    return { ver, pass: tests.filter((t) => t.ok).length, total: tests.length };
  });

  /** Rolling back replaces every merchant's knowledge, so only an admin may do it. */
  app.post<{ Body: { version: number } }>(`${A}/rollback`, async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can roll back.' });
    const [row] = await q(pool, 'SELECT snapshot FROM kb_versions WHERE version = ?', [req.body.version]);
    if (!row) return reply.code(404).send({ error: 'unknown version' });
    await writeSnapshot(pool, JSON.parse(row.snapshot));
    const ver = (await ensureVersion(pool)) + 1;
    await pool.query('INSERT INTO kb_versions(version, actor, summary, snapshot) VALUES(?,?,?,?)', [ver, req.user!.username, `Rolled back to v${req.body.version}`, row.snapshot]);
    await ctx.reloadBot();
    return { ver };
  });

  /** A copy of the bot built from the panel's draft, so the Test chat tab can try changes before they are published.
   *  For staff it only knows their own merchant. */
  app.post<{ Body: { snapshot: Snapshot; includeDrafts?: boolean } }>(`${A}/draft`, async (req) => {
    const user = req.user!;
    const snap = effectiveSnapshot(user, await readSnapshot(pool), req.body.snapshot);
    const known = await loadKnowledge(pool);
    const limits = Object.fromEntries(known.merchants.map((m) => [m.code, m.limits]));
    const bot = new Bot(knowledgeFromSnapshot(snap, await merchantsFor(pool, user), limits, !!req.body.includeDrafts));
    const id = randomUUID(); ctx.drafts.set(id, bot);
    while (ctx.drafts.size > 20) ctx.drafts.delete(ctx.drafts.keys().next().value!);
    return { draftId: id };
  });

  /* ---------- keywords ---------- */
  app.get<{ Querystring: { merchant: string } }>(`${A}/keywords`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const rows = await q(pool, `SELECT k.word, k.language, k.hits, k.status, k.source, k.note, k.guess, k.first_seen, k.last_seen FROM keyword_store k JOIN merchants m ON m.id = k.merchant_id
      WHERE m.code = ? ORDER BY k.hits DESC, k.word`, [req.query.merchant]);
    return rows.map((r) => ({ w: r.word, lg: r.language, n: Number(r.hits), ignored: r.status === 'ignored', from: r.source === 'test' ? 'Test chat' : 'Live chat', h: r.note ?? '', guess: r.guess ?? null, isNew: r.source === 'test', first: ago(r.first_seen), last: ago(r.last_seen), lastTs: r.last_seen.getTime() }));
  });

  /** Recent customer messages that contain a word (the "Recent chats with this word" list). */
  app.get<{ Querystring: { merchant: string; word: string } }>(`${A}/keywords/samples`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const like = `%${String(req.query.word ?? '').replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await q(pool, `SELECT cm.text, cm.created_at FROM chat_messages cm JOIN chat_sessions cs ON cs.id = cm.session_id JOIN merchants m ON m.id = cs.merchant_id
      WHERE m.code = ? AND cm.role = 'customer' AND cm.text LIKE ? ORDER BY cm.created_at DESC LIMIT 5`, [req.query.merchant, like]);
    return rows.map((r) => r.text as string);
  });

  app.post<{ Body: { merchant: string; words: string[]; ignored: boolean } }>(`${A}/keywords/ignore`, async (req, reply) => {
    const { merchant, words, ignored } = req.body;
    if (!mayUse(req, merchant)) return forbidden(reply);
    if (!words?.length) return { ok: true };
    await pool.query('UPDATE keyword_store k JOIN merchants m ON m.id = k.merchant_id SET k.status = ? WHERE m.code = ? AND k.word IN (?)', [ignored ? 'ignored' : 'new', merchant, words]);
    return { ok: true };
  });

  /** Words written per week. week 0 = the last 7 days, -1 = the 7 days before, and so on. */
  app.get<{ Querystring: { merchant: string; week?: string } }>(`${A}/ranking`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const week = Math.min(0, Math.max(-12, Number(req.query.week ?? 0) || 0));
    const [mer] = await q(pool, 'SELECT id FROM merchants WHERE code = ?', [req.query.merchant]);
    if (!mer) return { rows: [], total: 0, from: '', to: '' };
    const range = async (w: number) => q(pool, `SELECT word, DATEDIFF(DATE_ADD(CURDATE(), INTERVAL ? DAY), day) AS back, hits FROM keyword_daily
      WHERE merchant_id = ? AND day BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`, [w * 7, mer.id, w * 7 - 6, w * 7]);
    const [cur, prev] = [await range(week), await range(week - 1)];
    const series = new Map<string, number[]>(); let total = 0;
    for (const r of cur) { const a = series.get(r.word) ?? Array(7).fill(0); a[6 - Number(r.back)] += Number(r.hits); series.set(r.word, a); total += Number(r.hits); }
    const before = new Map<string, number>(); for (const r of prev) before.set(r.word, (before.get(r.word) ?? 0) + Number(r.hits));
    const meta = new Map((await q(pool, 'SELECT word, language, note, status FROM keyword_store WHERE merchant_id = ?', [mer.id])).map((r) => [r.word as string, r]));
    const rows = [...series.entries()].map(([w, s]) => {
      const n = s.reduce((a, b) => a + b, 0), p = before.get(w) ?? 0, m = meta.get(w);
      return { w, n, c: p ? Math.round(((n - p) / p) * 100) : 100, lg: m?.language ?? 'en', h: m?.note ?? '', series: s, ignored: m?.status === 'ignored' };
    }).sort((a, b) => b.n - a.n || a.w.localeCompare(b.w));
    const [d] = await q(pool, 'SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), "%b %e") AS a, DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), "%b %e") AS b', [week * 7 - 6, week * 7]);
    return { rows, total, from: d.a, to: d.b };
  });
}
