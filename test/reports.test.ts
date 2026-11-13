import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!reachable)('report: top topics, keywords, topics handed over, wrong-answer rate (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = ''; let key = '';
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  const ask = (q: string, s: string) => app.inject({ method: 'POST', url: '/api/v1/ai/ask', payload: { question: q, session_id: s }, headers: { authorization: 'Bearer ' + key } });
  const report = async () => (await as(admin, 'GET', '/api/admin/report?merchant=MERCH_A&days=7')).json();
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
    key = (await as(admin, 'POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json().key;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('counts the topic and the keywords of each message', async () => {
    for (let i = 0; i < 3; i++) await ask('how to deposit', 'r1-' + i);
    await ask('how long does withdraw take', 'r2');
    await wait(400);
    const r = await report();
    expect(r.topTopics.find((t: { topic: string }) => t.topic === 'deposit')?.n).toBeGreaterThanOrEqual(3);
    expect(r.topKeywords.map((k: { word: string }) => k.word)).toContain('deposit');
    expect(r.topKeywords[0].n).toBeGreaterThanOrEqual(3);
  });

  it('lists the topics handed to a person, and the wrong-answer rate comes from staff marks', async () => {
    await ask('my deposit was rejected', 'r3'); await wait(300);
    const first = await report(); expect(first.accuracy.wrongRate).toBeNull(); expect(first.recent.length).toBeGreaterThan(0);
    const [a, b] = first.recent;
    expect((await as(staff, 'POST', '/api/admin/feedback', { merchant: 'MERCH_A', decisionId: a.id, verdict: 'wrong' })).statusCode).toBe(200);
    expect((await as(admin, 'POST', '/api/admin/feedback', { merchant: 'MERCH_A', decisionId: b.id, verdict: 'right' })).statusCode).toBe(200);
    const r = await report(); expect(r.accuracy).toMatchObject({ right: 1, wrong: 1, checked: 2, wrongRate: 0.5 });
    await as(admin, 'POST', '/api/admin/feedback', { merchant: 'MERCH_A', decisionId: a.id, verdict: null });           // take a mark back
    expect((await report()).accuracy).toMatchObject({ checked: 1, wrongRate: 0 });
    expect(r.handedByTopic.find((t: { topic: string }) => t.topic === 'deposit')?.handed).toBeGreaterThanOrEqual(1);
  });

  it('keeps feedback inside the merchant, and rejects a bad mark', async () => {
    expect((await as(staff, 'POST', '/api/admin/feedback', { merchant: 'MERCH_B', decisionId: 1, verdict: 'wrong' })).statusCode).toBe(403);
    expect((await as(admin, 'POST', '/api/admin/feedback', { merchant: 'MERCH_A', decisionId: 1, verdict: 'maybe' })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/feedback', { merchant: 'MERCH_A', decisionId: 999999, verdict: 'wrong' })).statusCode).toBe(404);
  });
});
