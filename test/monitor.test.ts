import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { HealthMonitor } from '../src/monitor/health';
import { createNotifier } from '../src/monitor/notify';
import { Watchdog } from '../src/monitor/watchdog';
import { ask } from '../src/connector/ask';
import { Bot } from '../src/bot/responder';
import { Store } from '../src/bot/store';
import { loadKnowledge } from '../src/db/loadKnowledge';

const MIN = 60_000;
const make = () => {
  let t = 1_000_000; const said: string[] = [];
  const m = new HealthMonitor({ now: () => t, notify: async (x) => { said.push(x); } });
  return { m, said, advance: (ms: number) => { t += ms; } };
};

describe('the health monitor', () => {
  it('stays quiet while answers go well, and with too few calls to judge', async () => {
    const { m, said } = make();
    for (let i = 0; i < 20; i++) m.record('ok', 'MERCH_A', 300);
    expect((await m.check()).state).toBe('ok'); expect(said).toEqual([]);
    const b = make(); b.m.record('error', 'MERCH_A', 10, 'x'); b.m.record('timeout', 'MERCH_A', 8000); b.m.record('error', 'MERCH_A', 10);
    expect((await b.m.check()).state).toBe('ok'); expect(b.said).toEqual([]);                           // 3 calls are too few to say the bot is down
  });

  it('says "down" once when a quarter of the answers fail, repeats only every 30 minutes, and says when it is normal again', async () => {
    const { m, said, advance } = make();
    for (let i = 0; i < 6; i++) m.record('ok', 'MERCH_A', 300);
    m.record('timeout', 'MERCH_A', 8000, 'no answer within 8000 ms'); m.record('error', 'MERCH_A', 20, 'connection refused'); m.record('error', 'MERCH_A', 20, 'connection refused');
    let s = await m.check(); expect(s.state).toBe('down'); expect(s.failed).toBe(3); expect(s.lastError).toBe('connection refused');
    expect(s.worst).toEqual([{ merchant: 'MERCH_A', failed: 3, total: 9 }]);
    expect(said).toHaveLength(1); expect(said[0]).toMatch(/^🔴 2 of 8 answers failed/);                                     // said at the first moment the numbers crossed the line
    m.record('error', 'MERCH_A', 20); await m.check(); expect(said).toHaveLength(1);                     // still down: no second alert at once
    advance(31 * MIN); for (let i = 0; i < 4; i++) m.record('error', 'MERCH_A', 20);                       // 31 minutes later, new failures: the old ones are gone, but the problem goes on
    await m.check(); expect(said).toHaveLength(2); expect(said[1]).toMatch(/^🔴 Still a problem/);
    advance(6 * MIN); for (let i = 0; i < 6; i++) m.record('ok', 'MERCH_A', 300);                        // the failures left the 5 minute window
    s = await m.check(); expect(s.state).toBe('ok'); expect(said).toHaveLength(3); expect(said[2]).toMatch(/^🟢/);
    await m.check(); expect(said).toHaveLength(3);                                                       // only once
  });

  it('says "slow" when half of the answers take more than 5 seconds', async () => {
    const { m, said } = make();
    for (let i = 0; i < 3; i++) m.record('slow', 'MERCH_B', 6500); for (let i = 0; i < 3; i++) m.record('ok', 'MERCH_B', 200);
    const s = await m.check(); expect(s.state).toBe('slow'); expect(said[0]).toMatch(/slow: 3 of 4/);
  });

  it('says "badkey" when LiveChat calls with a wrong or stopped key three times', async () => {
    const { m, said } = make();
    m.record('badkey', '-', 0); m.record('badkey', '-', 0); expect((await m.check()).state).toBe('ok');
    m.record('badkey', '-', 0); const s = await m.check(); expect(s.state).toBe('badkey'); expect(said[0]).toMatch(/wrong or stopped bot key/);
  });

  it('says "down" when the database fails twice in a row, and recovers when it answers', async () => {
    const { m, said } = make();
    m.setDb(false); expect((await m.check()).state).toBe('ok');                                          // one failure is not enough
    m.setDb(false); const s = await m.check(); expect(s.state).toBe('down'); expect(s.db).toBe('down'); expect(said[0]).toMatch(/cannot reach its database/);
    m.setDb(true); expect((await m.check()).state).toBe('ok'); expect(said[1]).toMatch(/^🟢/);
  });

  it('does not say "normal again" just because the failures expired with no calls (night), and resets quietly after an hour', async () => {
    const { m, said, advance } = make();
    for (let i = 0; i < 5; i++) m.record('error', 'MERCH_A', 10);
    expect(said).toHaveLength(1);
    advance(10 * MIN); const s = await m.check();
    expect(s.state).toBe('ok'); expect(s.total).toBe(0); expect(said).toHaveLength(1);                   // the panel shows no problem, but no "all good" message without proof
    advance(60 * MIN); await m.check(); expect(said).toHaveLength(1);                                   // reset quietly
    for (let i = 0; i < 5; i++) m.record('error', 'MERCH_A', 10); expect(said).toHaveLength(2);          // and a new problem is told again
    advance(10 * MIN); m.record('ok', 'MERCH_A', 100); m.record('ok', 'MERCH_A', 100); await m.check();
    expect(said).toHaveLength(3); expect(said[2]).toMatch(/^🟢/);                                       // two good answers are proof
  });

  it('keeps working when the alert cannot be sent', async () => {
    const m = new HealthMonitor({ notify: async () => { throw new Error('webhook is down'); } });
    for (let i = 0; i < 6; i++) m.record('error', 'MERCH_A', 10);
    expect((await m.check()).state).toBe('down');
  });
});

describe('sending an alert', () => {
  const fake = (status = 200) => { const calls: { url: string; body: Record<string, string> }[] = []; return { calls, fn: (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}', { status }); }) as unknown as typeof fetch }; };
  it('posts to the webhook and to Telegram, with the name in front, and says "off" for what is not set', async () => {
    const f = fake(); const n = createNotifier({ webhookUrl: 'https://hooks.test/x', telegramToken: 'T0KEN', telegramChatId: '555', name: 'LuckyPay bot' }, f.fn);
    expect(n.configured).toEqual({ webhook: true, telegram: true });
    expect(await n.send('🔴 problem')).toEqual({ webhook: 'sent', telegram: 'sent' });
    expect(f.calls[0]).toEqual({ url: 'https://hooks.test/x', body: { text: 'LuckyPay bot: 🔴 problem', content: 'LuckyPay bot: 🔴 problem' } });
    expect(f.calls[1].url).toBe('https://api.telegram.org/botT0KEN/sendMessage'); expect(f.calls[1].body).toEqual({ chat_id: '555', text: 'LuckyPay bot: 🔴 problem' });
    const none = createNotifier({ webhookUrl: '', telegramToken: '', telegramChatId: '', name: 'x' }, f.fn);
    expect(none.configured).toEqual({ webhook: false, telegram: false }); expect(await none.send('hi')).toEqual({ webhook: 'off', telegram: 'off' });
  });
  it('reports a failure instead of throwing', async () => {
    const bad = createNotifier({ webhookUrl: 'https://hooks.test/x', telegramToken: '', telegramChatId: '', name: 'x' }, fake(500).fn);
    expect((await bad.send('hi')).webhook).toMatch(/failed: the address answered 500/);
    const down = createNotifier({ webhookUrl: 'https://hooks.test/x', telegramToken: '', telegramChatId: '', name: 'x' }, (async () => { throw new Error('getaddrinfo ENOTFOUND hooks.test'); }) as unknown as typeof fetch);
    expect((await down.send('hi')).webhook).toMatch(/failed: getaddrinfo ENOTFOUND/);
  });
});

describe('the watchdog (checks from outside)', () => {
  const run = () => {
    let t = 0; const said: string[] = []; let mode: 'ok' | 'dead' | '503' | 'dbdown' = 'ok';
    const fetchFn = (async () => { if (mode === 'dead') throw new Error('ECONNREFUSED'); if (mode === '503') return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ ok: mode !== 'dbdown' }), { status: 200 }); }) as unknown as typeof fetch;
    const w = new Watchdog({ url: 'http://bot.test/health', notify: async (x) => { said.push(x); }, fetchFn, now: () => t });
    return { w, said, set: (m: typeof mode) => { mode = m; }, advance: (ms: number) => { t += ms; } };
  };
  it('alerts after 3 failed checks in a row, not before, once, reminds every 30 minutes, and says when it is back', async () => {
    const { w, said, set, advance } = run();
    expect(await w.tick()).toBeNull();
    set('dead'); await w.tick(); await w.tick(); expect(said).toEqual([]);                                // 2 failures: wait
    expect(await w.tick()).toBe('cannot be reached'); expect(said).toHaveLength(1); expect(said[0]).toMatch(/does not answer at http:\/\/bot\.test\/health/);
    await w.tick(); await w.tick(); expect(said).toHaveLength(1);
    advance(31 * MIN); await w.tick(); expect(said).toHaveLength(2); expect(said[1]).toMatch(/Still down/);
    set('ok'); await w.tick(); expect(said).toHaveLength(3); expect(said[2]).toMatch(/^🟢/); await w.tick(); expect(said).toHaveLength(3);
  });
  it('a good check in between resets the count, and a 503 or "database down" counts as a problem', async () => {
    const { w, said, set } = run();
    set('dead'); await w.tick(); await w.tick(); set('ok'); await w.tick(); set('dead'); await w.tick(); await w.tick(); expect(said).toEqual([]);
    set('503'); expect(await w.tick()).toBe('answered 503'); expect(said).toHaveLength(1);
    const b = run(); b.set('dbdown'); expect(await b.w.tick()).toBe('answered, but says its database is down');
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the connector tells the monitor how each call went (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });
  const counts = (m: HealthMonitor) => m.status().counts;

  it('records ok, slow (more than 5 seconds), timeout and error', async () => {
    const m = new HealthMonitor(); const real = new Bot(await loadKnowledge(pool!)); const store = new Store(pool!);
    await ask({ pool: pool!, bot: real, store, monitor: m }, 'MERCH_A', { question: 'how long deposit take monitor' });
    expect(counts(m).ok).toBe(1);
    const slow = Object.assign(Object.create(real), { message: () => new Promise((r) => setTimeout(() => r(null), 400)), engine: real.engine }) as Bot;
    await ask({ pool: pool!, bot: slow, store, timeoutMs: 40, monitor: m }, 'MERCH_A', { question: 'where is my money monitor' });
    expect(counts(m).timeout).toBe(1); expect(m.status().lastError).toMatch(/no answer within 40 ms/);
    const broken = Object.assign(Object.create(real), { message: async () => { throw new Error('the model blew up'); }, engine: real.engine }) as Bot;
    await ask({ pool: pool!, bot: broken, store, monitor: m }, 'MERCH_A', { question: 'something else monitor' });
    expect(counts(m).error).toBe(1); expect(m.status().lastError).toBe('the model blew up');
    expect(m.status().worst[0]).toMatchObject({ merchant: 'MERCH_A', failed: 2 });
  });

  it('the app: wrong keys make "badkey", /health says the state, the panel route shows it, and only an admin can send a test alert', async () => {
    const sent: string[] = []; const m = new HealthMonitor({ notify: async (t) => { sent.push(t); } });
    const notifier = { configured: { webhook: true, telegram: false }, send: async (t: string) => { sent.push(t); return { webhook: 'sent', telegram: 'off' }; } };
    const app: FastifyInstance = await buildApp({ pool: pool!, logger: false, monitor: m, notifier });
    try {
      const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
      const admin = await login(DEMO_ADMIN), staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'POST', url: '/api/v1/ai/ask', payload: { question: 'hi' }, headers: { authorization: 'Bearer aib_wrong' } })).statusCode).toBe(401);
      const health = (await app.inject({ method: 'GET', url: '/health' })); expect(health.statusCode).toBe(200); expect(health.json()).toMatchObject({ ok: true, db: 'up', state: 'badkey' });
      const mine = (await app.inject({ method: 'GET', url: '/api/admin/health', headers: { cookie: staff } })).json();
      expect(mine).toMatchObject({ state: 'badkey', alerts: { webhook: true, telegram: false } }); expect(mine.counts.badkey).toBe(3);
      expect(sent[0]).toMatch(/wrong or stopped bot key/);
      expect((await app.inject({ method: 'GET', url: '/api/admin/health' })).statusCode).toBe(401);       // a login is needed
      expect((await app.inject({ method: 'POST', url: '/api/admin/health/test', headers: { cookie: staff } })).statusCode).toBe(403);
      const t = (await app.inject({ method: 'POST', url: '/api/admin/health/test', headers: { cookie: admin } })).json();
      expect(t.sent).toEqual({ webhook: 'sent', telegram: 'off' }); expect(sent[sent.length - 1]).toMatch(/test alert/);
    } finally { await app.close(); }
  });
});
