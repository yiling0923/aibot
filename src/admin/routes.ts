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
import type { AiService } from '../ai/types';
import { Store } from '../bot/store';
import { knowledgeFromSnapshot, readMerchants, readSnapshot, writeSnapshot, type MerchantMeta, type Snapshot } from './snapshot';
import { Tenants, tbl } from '../db/tenants';
import { ensureVersions, readVersion, merchantSig, merchantSlice, recordVersion, sharedSig, sharedSlice, versionState, withMerchantSlice, withSharedSlice, type MerchantSlice, type SharedSlice } from './versions';

export interface AdminCtx { pool: Pool; reloadBot: () => Promise<Bot>; drafts: Map<string, Bot>; ai: AiService }

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

const ago = (d: Date) => {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`;
};

/** Runs every sample message of every merchant (each merchant's own test cases) through the engine built from this knowledge. */
export async function runTests(pool: Pool, engine: Engine) {
  const out: { merchant: string; message: string; language: string; expected: string; expIntent: string | null; got: string; gotIntent: string | null; ok: boolean }[] = [];
  for (const t of await new Tenants(pool).list()) {
    if (!engine.hasMerchant(t.code)) continue;
    const cases = await q(pool, `SELECT message, language, expected_decision, expected_intent FROM ${tbl(t.db, 'eval_cases')} ORDER BY id`);
    for (const c of cases) {
      const r = engine.analyze(c.message, t.code, 0);
      const got = r.decision, gotIntent = got === 'ANSWER' ? r.top.intent : null;
      const ok = got === c.expected_decision && (c.expected_decision !== 'ANSWER' || gotIntent === c.expected_intent);
      out.push({ merchant: t.code, message: c.message, language: c.language, expected: c.expected_decision, expIntent: c.expected_intent, got, gotIntent, ok });
    }
  }
  return out;
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
    await ensureVersions(pool);
    const merchants = await merchantsFor(pool, user);
    const v = await versionState(pool, user, merchants.map((m) => m.code));
    const history = v.history.map((h) => ({ kind: h.kind, merchant: h.merchant, version: h.version, actor: h.actor, summary: h.summary, ago: ago(h.created_at) }));
    return { versions: v.versions, sharedVer: v.sharedVer, stamp: v.stamp, merchants, snapshot: scopeSnapshot(user, await readSnapshot(pool)), history,
      user: { username: user.username, role: user.role, merchant: user.merchant }, ai: { pick: ctx.ai.canPick, write: ctx.ai.canWrite, describe: ctx.ai.canDescribe } };
  });

  app.post<{ Body: { snapshot: Snapshot; includeDrafts?: boolean } }>(`${A}/tests`, async (req) => {
    const user = req.user!;
    const snap = effectiveSnapshot(user, await readSnapshot(pool), req.body.snapshot);
    const all = await runTests(pool, await engineFor(pool, snap, !!req.body.includeDrafts, await readMerchants(pool)));
    const results = user.role === 'admin' ? all : all.filter((r) => r.merchant === user.merchant);
    return { results, pass: results.filter((r) => r.ok).length, total: results.length };
  });

  /** Publishes the draft. Only the merchants whose data really changed get a new version (each has its own history),
   *  and the shared word lists get one only if they changed. */
  app.post<{ Body: { snapshot: Snapshot; changes: string[] } }>(`${A}/publish`, async (req, reply) => {
    const user = req.user!;
    const { snapshot, changes = [] } = req.body ?? ({} as never);
    if (!snapshot?.kb) return reply.code(400).send({ error: 'snapshot is required' });
    const current = await readSnapshot(pool);
    const snap = effectiveSnapshot(user, current, snapshot);
    const all = await runTests(pool, await engineFor(pool, snap, false, await readMerchants(pool)));
    const tests = user.role === 'admin' ? all : all.filter((r) => r.merchant === user.merchant);
    const changed = Object.keys(snap.settings).filter((c) => merchantSig(merchantSlice(snap, c)) !== merchantSig(merchantSlice(current, c)));
    const sharedChanged = sharedSig(sharedSlice(snap)) !== sharedSig(sharedSlice(current));
    await ensureVersions(pool);                                           // so there is always an earlier version to go back to
    await writeSnapshot(pool, snap, { merchants: changed, shared: sharedChanged });
    const after = await readSnapshot(pool);
    const summary = `${changes.length} change${changes.length === 1 ? '' : 's'} published: ${changes.slice(0, 2).join('; ')}${changes.length > 2 ? '…' : ''}`;
    const published: { scope: 'merchant' | 'shared'; code?: string; ver: number }[] = [];
    for (const code of changed) published.push({ scope: 'merchant', code, ver: await recordVersion(pool, { kind: 'merchant', code }, user.username, summary, merchantSlice(after, code)) });
    if (sharedChanged) published.push({ scope: 'shared', ver: await recordVersion(pool, { kind: 'shared' }, user.username, summary, sharedSlice(after)) });
    await ctx.reloadBot();
    return { published, pass: tests.filter((t) => t.ok).length, total: tests.length };
  });

  /** Rolls one merchant (or the shared word lists, when no merchant is given) back to a saved version. Other merchants are not touched.
   *  Staff may roll back their own merchant; the shared lists are for admins. */
  app.post<{ Body: { merchant?: string | null; version: number } }>(`${A}/rollback`, async (req, reply) => {
    const user = req.user!; const merchant = req.body?.merchant || null;
    if (merchant ? !mayUse(req, merchant) : user.role !== 'admin') return reply.code(403).send({ error: merchant ? 'You can only roll back your own merchant.' : 'Only an admin can roll back the shared word lists.' });
    if (merchant && !(await new Tenants(pool).get(merchant))) return reply.code(404).send({ error: 'unknown merchant' });
    const scope = merchant ? ({ kind: 'merchant', code: merchant } as const) : ({ kind: 'shared' } as const);
    const row = await readVersion(pool, scope, Number(req.body?.version));
    if (!row) return reply.code(404).send({ error: 'unknown version' });
    const current = await readSnapshot(pool);
    const slice = JSON.parse(row.snapshot);
    const summary = `Rolled back to v${row.version}`;
    if (merchant) await writeSnapshot(pool, withMerchantSlice(current, merchant, slice as MerchantSlice), { merchants: [merchant], shared: false });
    else await writeSnapshot(pool, withSharedSlice(current, slice as SharedSlice), { merchants: [], shared: true });
    const ver = await recordVersion(pool, scope, user.username, summary, slice);
    await ctx.reloadBot();
    return { ver, scope: scope.kind, merchant };
  });

  /** A copy of the bot built from the panel's draft, so the Test chat tab can try changes before they are published.
   *  For staff it only knows their own merchant. */
  app.post<{ Body: { snapshot: Snapshot; includeDrafts?: boolean } }>(`${A}/draft`, async (req) => {
    const user = req.user!;
    const snap = effectiveSnapshot(user, await readSnapshot(pool), req.body.snapshot);
    const known = await loadKnowledge(pool);
    const limits = Object.fromEntries(known.merchants.map((m) => [m.code, m.limits]));
    const bot = new Bot(knowledgeFromSnapshot(snap, await merchantsFor(pool, user), limits, !!req.body.includeDrafts), undefined, ctx.ai);
    const id = randomUUID(); ctx.drafts.set(id, bot);
    while (ctx.drafts.size > 20) ctx.drafts.delete(ctx.drafts.keys().next().value!);
    return { draftId: id };
  });

  /* ---------- keywords (each merchant's words are in its own database) ---------- */
  const tenants = new Tenants(pool);
  /** The merchant's own table, or null when there is no such merchant. */
  const mt = async (code: string | undefined, table: string) => { const t = code ? await tenants.get(code) : null; return t ? tbl(t.db, table) : null; };

  app.get<{ Querystring: { merchant: string } }>(`${A}/keywords`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const T = await mt(req.query.merchant, 'keyword_store'); if (!T) return [];
    const rows = await q(pool, `SELECT word, language, hits, status, source, note, guess, first_seen, last_seen FROM ${T} ORDER BY hits DESC, word`);
    return rows.map((r) => ({ w: r.word, lg: r.language, n: Number(r.hits), ignored: r.status === 'ignored', from: r.source === 'test' ? 'Test chat' : 'Live chat', h: r.note ?? '', guess: r.guess ?? null, isNew: r.source === 'test', first: ago(r.first_seen), last: ago(r.last_seen), lastTs: new Date(r.last_seen).getTime() }));
  });

  /** Asks Claude to describe the keywords that have no description yet (the newest first), a few at a time. */
  app.post<{ Body: { merchant: string } }>(`${A}/keywords/describe`, async (req, reply) => {
    const merchant = req.body?.merchant;
    if (!mayUse(req, merchant)) return forbidden(reply);
    if (!ctx.ai.canDescribe) return reply.code(409).send({ error: 'The AI is not set up yet. Add the Anthropic key to .env.' });
    const known = await loadKnowledge(pool);
    const merchantName = known.merchants.find((m) => m.code === merchant)?.name ?? merchant;
    const topics = Object.keys(known.globalAliases);
    const K = await mt(merchant, 'keyword_store'), M = await mt(merchant, 'chat_messages'); if (!K || !M) return { done: 0, tried: 0 };
    const rows = await q(pool, `SELECT word FROM ${K} WHERE note IS NULL AND status <> 'ignored' ORDER BY last_seen DESC LIMIT 15`);
    const store = new Store(pool); let done = 0;
    for (const r of rows) {
      const sample = (await q(pool, `SELECT text FROM ${M} WHERE text LIKE ? ORDER BY created_at DESC LIMIT 1`, [`%${String(r.word).replace(/[%_\\]/g, '\\$&')}%`]))[0]?.text ?? String(r.word);
      const d = await ctx.ai.describeWord({ word: r.word, sample, merchantName, topics });
      if (d) { await store.setNote(merchant, r.word, d.note, d.type); done++; }
    }
    return { done, tried: rows.length };
  });

  /** Recent customer messages that contain a word (the "Recent chats with this word" list). */
  app.get<{ Querystring: { merchant: string; word: string } }>(`${A}/keywords/samples`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const M = await mt(req.query.merchant, 'chat_messages'); if (!M) return [];
    const like = `%${String(req.query.word ?? '').replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await q(pool, `SELECT text FROM ${M} WHERE role = 'customer' AND text LIKE ? ORDER BY created_at DESC LIMIT 5`, [like]);
    return rows.map((r) => r.text as string);
  });

  app.post<{ Body: { merchant: string; words: string[]; ignored: boolean } }>(`${A}/keywords/ignore`, async (req, reply) => {
    const { merchant, words, ignored } = req.body;
    if (!mayUse(req, merchant)) return forbidden(reply);
    if (!words?.length) return { ok: true };
    const K = await mt(merchant, 'keyword_store'); if (!K) return { ok: true };
    await pool.query(`UPDATE ${K} SET status = ? WHERE word IN (?)`, [ignored ? 'ignored' : 'new', words]);
    return { ok: true };
  });

  /** Words written per week. week 0 = the last 7 days, -1 = the 7 days before, and so on. */
  app.get<{ Querystring: { merchant: string; week?: string } }>(`${A}/ranking`, async (req, reply) => {
    if (!mayUse(req, req.query.merchant)) return forbidden(reply);
    const week = Math.min(0, Math.max(-12, Number(req.query.week ?? 0) || 0));
    const DAILY = await mt(req.query.merchant, 'keyword_daily'), K = await mt(req.query.merchant, 'keyword_store');
    if (!DAILY || !K) return { rows: [], total: 0, from: '', to: '' };
    const range = async (w: number) => q(pool, `SELECT word, DATEDIFF(DATE_ADD(CURDATE(), INTERVAL ? DAY), day) AS back, hits FROM ${DAILY}
      WHERE day BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`, [w * 7, w * 7 - 6, w * 7]);
    const [cur, prev] = [await range(week), await range(week - 1)];
    const series = new Map<string, number[]>(); let total = 0;
    for (const r of cur) { const a = series.get(r.word) ?? Array(7).fill(0); a[6 - Number(r.back)] += Number(r.hits); series.set(r.word, a); total += Number(r.hits); }
    const before = new Map<string, number>(); for (const r of prev) before.set(r.word, (before.get(r.word) ?? 0) + Number(r.hits));
    const meta = new Map((await q(pool, `SELECT word, language, note, status FROM ${K}`)).map((r) => [r.word as string, r]));
    const rows = [...series.entries()].map(([w, s]) => {
      const n = s.reduce((a, b) => a + b, 0), p = before.get(w) ?? 0, m = meta.get(w);
      return { w, n, c: p ? Math.round(((n - p) / p) * 100) : 100, lg: m?.language ?? 'en', h: m?.note ?? '', series: s, ignored: m?.status === 'ignored' };
    }).sort((a, b) => b.n - a.n || a.w.localeCompare(b.w));
    const [d] = await q(pool, 'SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), "%b %e") AS a, DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), "%b %e") AS b', [week * 7 - 6, week * 7]);
    return { rows, total, from: d.a, to: d.b };
  });
}
