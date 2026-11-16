import 'dotenv/config';
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { dbNameFor, tbl } from '../src/db/tenants';
import { cleanPhrases, loadKnowledge } from '../src/db/loadKnowledge';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { effectiveSnapshot } from '../src/admin/scope';
import { purgeOldChats } from '../src/db/retention';
import type { FastifyInstance } from 'fastify';
import { seedJson, accountsJson } from './helpers';

const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson)); const cfg = bot.engine.merchant('MERCH_A');
afterEach(() => { delete cfg.triggerPhrases; delete cfg.handoffComplaint; delete cfg.handoffAccount; });
const say = async (text: string) => (await bot.message(newSession('hr-' + Math.random(), 'MERCH_A', null), text))!;

describe('handoff rules of a merchant', () => {
  it('trigger phrases send the chat straight to a person, in any language, even with accents or other case', async () => {
    expect((await say('how to deposit vip')).trace.decision).not.toBe('HANDOFF');                    // not a trigger yet
    cfg.triggerPhrases = ['vip', 'withdraw lambat', '紧急'];
    for (const m of ['I am a VIP member, how to deposit', 'withdraw lambat sangat', '我的事情很紧急']) {
      const t = await say(m); expect(t.trace.decision).toBe('HANDOFF'); expect(t.trace.why).toMatch(/trigger phrase/);
    }
    expect((await say('how to deposit')).trace.decision).toBe('ANSWER');                             // other messages are not affected
    expect((await say('vipers are snakes')).trace.decision).not.toBe('HANDOFF');                     // a whole word, not a part of one
  });

  it('a complaint goes to a person by default; the merchant can switch that off', async () => {
    const m = 'my deposit failed and was rejected';
    expect((await say(m)).trace.decision).toBe('HANDOFF');
    cfg.handoffComplaint = false; const t = await say(m); expect(t.trace.decision).not.toBe('HANDOFF'); expect(t.trace.why ?? '').not.toMatch(/reports a problem/);
  });

  it('a phone or bank account number written in the chat goes to a person, but an amount does not; the merchant can switch it off', async () => {
    for (const m of ['my account is 1234567890123', 'my number is 012-3456 7890', 'phone +60123456789 please']) {
      const t = await say(m); expect(t.trace.decision).toBe('HANDOFF'); expect(t.trace.why).toMatch(/account details/);
    }
    for (const m of ['how to deposit 100000', 'deposit 1,000,000 how long', 'withdraw 5000']) expect((await say(m)).trace.decision).not.toBe('HANDOFF');
    cfg.handoffAccount = false; expect((await say('my account is 1234567890123')).trace.why ?? '').not.toMatch(/account details/);
  });

  it('cleans the phrases: lower case, no empty or one-letter ones, no repeats, at most 50', () => {
    expect(cleanPhrases(' VIP, ,x, vip ,Withdraw Lambat\nurgent')).toEqual(['vip', 'withdraw lambat', 'urgent']);
    expect(cleanPhrases(Array.from({ length: 80 }, (_, i) => 'phrase' + i).join(','))).toHaveLength(50);
    expect(cleanPhrases(null)).toEqual([]);
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('saved handoff rules and the retention sweep (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = '';
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    admin = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('saves the switches and phrases with the draft, loads them into the bot, and staff may only change the phrases', async () => {
    const snap = await readSnapshot(pool!);
    expect(snap.settings.MERCH_A).toMatchObject({ handoff_complaint: true, handoff_account: true, trigger_phrases: '' });          // the defaults
    const next = JSON.parse(JSON.stringify(snap)); Object.assign(next.settings.MERCH_A, { handoff_complaint: false, handoff_account: false, trigger_phrases: ' VIP, urgent ' });
    await writeSnapshot(pool!, next, { merchants: ['MERCH_A'], shared: false });
    expect((await readSnapshot(pool!)).settings.MERCH_A).toMatchObject({ handoff_complaint: false, handoff_account: false, trigger_phrases: 'vip, urgent' });
    const a = (await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_A')!;
    expect(a).toMatchObject({ handoffComplaint: false, handoffAccount: false, triggerPhrases: ['vip', 'urgent'] });
    expect((await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_B')).not.toHaveProperty('triggerPhrases');           // another merchant keeps the defaults
    const staffView = effectiveSnapshot({ username: 'luckypay', role: 'staff', merchant: 'MERCH_A' } as never, snap,
      { ...snap, settings: { ...snap.settings, MERCH_A: { ...snap.settings.MERCH_A, handoff_complaint: false, handoff_account: false, trigger_phrases: 'staff phrase' } } });
    expect(staffView.settings.MERCH_A).toMatchObject({ handoff_complaint: true, handoff_account: true, trigger_phrases: 'staff phrase' });    // switches stay as they were
  });

  it('keeps conversations for the days a merchant sets, deletes older ones with their messages, and keeps everything when it is not set', async () => {
    const S = tbl(dbNameFor('livechat_bot_test', 'MERCH_A'), 'chat_sessions'), M = tbl(dbNameFor('livechat_bot_test', 'MERCH_A'), 'chat_messages');
    await pool!.query(`DELETE FROM ${S}`);
    const mk = async (id: string, daysAgo: number) => { const [r] = await pool!.query<import('mysql2/promise').ResultSetHeader>(`INSERT INTO ${S}(livechat_chat_id, status, started_at) VALUES(?, 'open', DATE_SUB(NOW(), INTERVAL ? DAY))`, [id, daysAgo]); await pool!.query(`INSERT INTO ${M}(session_id, role, text) VALUES(?, 'customer', 'hi')`, [r.insertId]); };
    await mk('old', 100); await mk('mid', 40); await mk('new', 1);
    const count = async () => Number(((await pool!.query<import('mysql2/promise').RowDataPacket[]>(`SELECT COUNT(*) n FROM ${S}`))[0] as { n: number }[])[0].n);
    expect(await purgeOldChats(pool!)).toEqual({}); expect(await count()).toBe(3);                    // no retention set: nothing is deleted
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/basics', { retentionDays: 90 })).statusCode).toBe(200);
    expect((await as(admin, 'GET', '/api/admin/merchants/MERCH_A/basics')).json().retentionDays).toBe(90);
    expect(await purgeOldChats(pool!)).toEqual({ MERCH_A: 1 }); expect(await count()).toBe(2);        // only the 100 day old chat goes
    expect(Number(((await pool!.query<import('mysql2/promise').RowDataPacket[]>(`SELECT COUNT(*) n FROM ${M}`))[0] as { n: number }[])[0].n)).toBe(2);   // its message went with it
    await as(admin, 'POST', '/api/admin/merchants/MERCH_A/basics', { retentionDays: 30 }); await purgeOldChats(pool!); expect(await count()).toBe(1);
    await as(admin, 'POST', '/api/admin/merchants/MERCH_A/basics', { retentionDays: 0 }); expect((await as(admin, 'GET', '/api/admin/merchants/MERCH_A/basics')).json().retentionDays).toBe(0);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/basics', { retentionDays: -3 })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/basics', { retentionDays: 99999 })).statusCode).toBe(400);
  });
});
void DEMO_STAFF_PASSWORD;
