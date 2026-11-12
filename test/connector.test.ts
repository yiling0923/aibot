import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { dbNameFor, tbl } from '../src/db/tenants';
import { ask, matchChoice, parseMember } from '../src/connector/ask';
import { Bot } from '../src/bot/responder';
import { Store } from '../src/bot/store';
import { loadKnowledge } from '../src/db/loadKnowledge';
import type { Button } from '../src/bot/responder';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe('choosing from a numbered list by replying', () => {
  const choices = [{ kind: 'intent', key: 'deposit_how', label: 'How to deposit' }, { kind: 'intent', key: 'deposit_time', label: 'Deposit time' }, { kind: 'intent', key: 'deposit_limit', label: 'Deposit limits' }, { kind: 'agent', key: 'agent', label: 'Talk to an agent' }] as Button[];
  it('understands a number, an ordinal and words from the choice', () => {
    expect(matchChoice('2', choices)?.key).toBe('deposit_time');
    expect(matchChoice(' 3. ', choices)?.key).toBe('deposit_limit');
    expect(matchChoice('the first one', choices)?.key).toBe('deposit_how');
    expect(matchChoice('second', choices)?.key).toBe('deposit_time');
    expect(matchChoice('deposit time', choices)?.key).toBe('deposit_time');
    expect(matchChoice('limits', choices)?.key).toBe('deposit_limit');
    expect(matchChoice('agent', choices)?.kind).toBe('agent');
  });
  it('treats anything else as a new question', () => {
    expect(matchChoice('9', choices)).toBeNull();                 // there is no 9th choice
    expect(matchChoice('deposit', choices)).toBeNull();           // three choices contain "deposit": not clear, so it is a new question
    expect(matchChoice('my money has not arrived', choices)).toBeNull();
    expect(matchChoice('', choices)).toBeNull();
  });
  it('reads the member in the spellings LiveChat uses', () => {
    expect(parseMember({ externalId: 'M10023', name: 'Ali', rank: 'GOLD' })).toEqual({ id: 'M10023', name: 'Ali', rank: 'GOLD' });
    expect(parseMember({ id: 8841, name: 'Tom' })).toEqual({ id: '8841', name: 'Tom', rank: undefined });
    expect(parseMember({ name: 'no id' })).toBeNull();
    expect(parseMember('nope')).toBeNull();
  });
});

describe.skipIf(!reachable)('the LiveChat connector (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let adminCookie = ''; let keyA = ''; let keyB = '';
  const merchDb = (code: string) => dbNameFor('livechat_bot_test', code);
  const rows = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
  const call = (key: string | null, payload: object, a: FastifyInstance = app) => a.inject({ method: 'POST', url: '/api/v1/ai/ask', payload: payload as object, headers: key ? { authorization: 'Bearer ' + key } : {} });
  const admin = (method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie: adminCookie } });

  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    adminCookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN })).headers['set-cookie']).split(';')[0];
    keyA = (await admin('POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json().key;
    keyB = (await admin('POST', '/api/admin/merchants/MERCH_B/bot-key', {})).json().key;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('only answers with a valid bot key, and the key says which merchant is asking', async () => {
    expect((await call(null, { question: 'hi' })).statusCode).toBe(401);
    expect((await call('aib_wrong', { question: 'hi' })).statusCode).toBe(401);
    const a = (await call(keyA, { question: 'depo how' })).json(), b = (await call(keyB, { question: 'depo how' })).json();
    expect(a.answer).not.toBe(b.answer);                                                // each merchant answers from its own knowledge base
    expect(a.answer).toContain('Wallet > Deposit');
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/ask', payload: { question: 'x' }, headers: { cookie: adminCookie } })).statusCode).toBe(401);   // a panel login does not open it
  });

  it('keeps only a hash of the key, shows the key once, and "replace" stops the old key', async () => {
    const listed = (await admin('GET', '/api/admin/merchants/MERCH_A/bot-keys')).json();
    expect(JSON.stringify(listed)).not.toContain(keyA);
    expect(listed[0]).toMatchObject({ prefix: keyA.slice(0, 8), revokedAt: null });
    const stored = await rows('SELECT key_hash FROM bot_api_keys WHERE key_prefix = ?', [keyA.slice(0, 8)]);
    expect(stored[0].key_hash).toHaveLength(64); expect(stored[0].key_hash).not.toBe(keyA);
    const fresh = (await admin('POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json().key;     // replace is the default
    expect((await call(keyA, { question: 'hi' })).statusCode).toBe(401);                            // the old key stopped
    expect((await call(fresh, { question: 'hi' })).statusCode).toBe(200);
    keyA = fresh;
    expect((await admin('POST', '/api/admin/merchants/MERCH_A/bot-key/revoke')).json().revoked).toBe(1);
    expect((await call(keyA, { question: 'hi' })).statusCode).toBe(401);
    keyA = (await admin('POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json().key;
    const staff = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'luckypay', password: DEMO_STAFF_PASSWORD } })).headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'POST', url: '/api/admin/merchants/MERCH_A/bot-key', payload: {}, headers: { cookie: staff } })).statusCode).toBe(403);   // admin only
    expect((await call(keyA, { question: 'hi' })).json().session_id).toBeTruthy();
  });

  it('answers in the shape LiveChat expects, including its connectivity test', async () => {
    const r = await call(keyA, { question: 'Can you help?', history: [] });                          // exactly what "Test AI Chat" sends
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(typeof j.answer).toBe('string'); expect(typeof j.confidence).toBe('number');
    expect(typeof j.should_escalate).toBe('boolean'); expect(typeof j.should_close).toBe('boolean');
    expect(j).toHaveProperty('close_message'); expect(j.session_id).toMatch(/^bot_/);
    const withHistory = (await call(keyA, { question: 'How long does it take?', history: [{ role: 'user', text: 'Can you help?', created_at: '2026-07-10T07:11:54Z' }, { role: 'bot', text: 'x' }], session_id: j.session_id })).json();
    expect(withHistory.session_id).toBe(j.session_id);                                              // the same chat keeps its id
    expect((await call(keyA, { question: '' })).statusCode).toBe(400);
    expect((await call(keyA, { question: 'hi', session_id: 'bad id with spaces' })).statusCode).toBe(400);
  });

  it('writes choices into the answer as a numbered list and lets the next message pick one', async () => {
    const first = (await call(keyA, { question: 'dep' })).json();
    expect(first.decision).toBe('clarify'); expect(first.choices.length).toBeGreaterThanOrEqual(3);
    expect(first.answer).toMatch(/1\. .+\n2\. .+\n3\. /);
    const second = (await call(keyA, { question: '2', session_id: first.session_id })).json();
    expect(second.decision).toBe('answer'); expect(second.answer).toContain('5 minutes');            // "Deposit time"
    const again = (await call(keyA, { question: 'dep' })).json();
    const third = (await call(keyA, { question: 'withdraw time please', session_id: again.session_id })).json();   // not a choice: a new question
    expect(third.answer).toContain('30 minutes');
  });

  it('remembers the chat in the database: it survives a restart, hands over after the second miss, then stays silent', async () => {
    const one = (await call(keyA, { question: 'blorp zzz qqq' })).json();
    expect(one.decision).toBe('clarify'); expect(one.should_escalate).toBe(false);                  // asks once more
    const restarted = await buildApp({ pool: pool!, logger: false });                                // a restart: nothing is left in memory
    try {
      const two = (await call(keyA, { question: 'blorp zzz qqq again', session_id: one.session_id }, restarted)).json();
      expect(two.decision).toBe('handover'); expect(two.should_escalate).toBe(true); expect(two.answer).not.toBe('');
      const three = (await call(keyA, { question: 'hello?', session_id: one.session_id }, restarted)).json();
      expect(three.decision).toBe('silent'); expect(three.answer).toBe(''); expect(three.should_escalate).toBe(true);
    } finally { await restarted.close(); }
    const saved = await rows(`SELECT state FROM ${tbl(merchDb('MERCH_A'), 'bot_sessions')} WHERE session_id = ?`, [one.session_id]);
    expect(JSON.parse(saved[0].state).session.handed).toBe(true);
  });

  it('answers a repeated request the same way and does not move the chat twice', async () => {
    const body = { question: 'any promotion?', history: [{ role: 'user', text: 'any promotion?', created_at: '2026-11-12T10:00:00Z' }] };
    const a = (await call(keyA, body)).json(), b = (await call(keyA, body)).json();
    expect(b).toEqual(a);
    const msgs = await rows(`SELECT COUNT(*) AS n FROM ${tbl(merchDb('MERCH_A'), 'chat_messages')} m JOIN ${tbl(merchDb('MERCH_A'), 'chat_sessions')} s ON s.id = m.session_id WHERE s.livechat_chat_id = ?`, [a.session_id]);
    expect(Number(msgs[0].n)).toBe(1);                                                              // logged once
    const other = (await call(keyA, { ...body, history: [{ role: 'user', text: 'any promotion?', created_at: '2026-11-12T10:00:01Z' }] })).json();
    expect(other.session_id).not.toBe(a.session_id);                                                // a different chat is a different request
  });

  it('hands the chat to a person when the bot is too slow, and remembers it', async () => {
    const real = new Bot(await loadKnowledge(pool!));
    const slow = Object.assign(Object.create(real), { message: () => new Promise((r) => setTimeout(() => r(null), 400)), engine: real.engine }) as Bot;
    const r = await ask({ pool: pool!, bot: slow, store: new Store(pool!), timeoutMs: 40 }, 'MERCH_A', { question: 'where is my money' });
    expect(r.decision).toBe('handover'); expect(r.should_escalate).toBe(true); expect(r.answer.length).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 500));                                              // the slow work finishes late and must change nothing
    const next = await ask({ pool: pool!, bot: real, store: new Store(pool!) }, 'MERCH_A', { question: 'hello', session_id: r.session_id });
    expect(next.decision).toBe('silent');
  });

  it('saves what the customer wrote as live traffic, and knows the member only when the channel says who they are', async () => {
    const visitor = (await call(keyA, { question: 'my balance' })).json();
    expect(visitor.answer).toContain("can't see your account");
    const member = (await call(keyA, { question: 'my balance', member: { externalId: '8841', name: 'Tom', rank: 'GOLD' } })).json();
    expect(member.answer).toContain('MYR 1,250.00');
    const live = await rows(`SELECT COUNT(*) AS n FROM ${tbl(merchDb('MERCH_A'), 'chat_sessions')} WHERE source = 'live'`);
    expect(Number(live[0].n)).toBeGreaterThan(1);
    const kw = await rows(`SELECT source FROM ${tbl(merchDb('MERCH_A'), 'keyword_store')} WHERE word = 'blorp'`);
    expect(kw[0].source).toBe('live');
  });
});
