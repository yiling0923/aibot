import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { hashPassword, verifyPassword } from '../src/auth/passwords';
import { makeSession, readSession } from '../src/auth/session';
import { upsertUser } from '../src/auth/users';
import { seedJson } from './helpers';

describe('passwords and session cookies', () => {
  it('hashes passwords and checks them', () => {
    const h = hashPassword('secret1');
    expect(h).not.toContain('secret1');
    expect(verifyPassword('secret1', h)).toBe(true);
    expect(verifyPassword('secret2', h)).toBe(false);
    expect(verifyPassword('secret1', 'garbage')).toBe(false);
  });

  it('a session cannot be changed, forged or used after it expires', () => {
    const staff = { username: 'luckypay', role: 'staff' as const, merchant: 'MERCH_A' };
    const good = makeSession(staff, 'k1');
    expect(readSession(good, 'k1')).toEqual(staff);
    expect(readSession(good, 'other-key')).toBeNull();
    const [p, s] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ username: 'x', role: 'admin', merchant: null, exp: 9999999999 })).toString('base64url');
    expect(readSession(`${forged}.${s}`, 'k1')).toBeNull();                       // new content with the old signature
    expect(readSession(`${p}.AAAA`, 'k1')).toBeNull();
    expect(readSession(good, 'k1', Date.now() + 13 * 3600 * 1000)).toBeNull();    // expired
    expect(readSession(makeSession({ username: 'u', role: 'staff', merchant: null }, 'k1'), 'k1')).toBeNull();   // staff without a merchant
    expect(readSession(undefined)).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let reachable = false;
if (url) { pool = createPool(url, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('sign in and merchant lock (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); app = await buildApp({ pool: pool!, logger: false }); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  const login = async (username: string, password: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    const cookie = String(r.headers['set-cookie'] ?? '').split(';')[0];
    return { status: r.statusCode, cookie, body: r.json() };
  };
  const as = (cookie: string) => ({ cookie });
  const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? as(cookie) : {} });
  const post = (url: string, payload: unknown, cookie?: string) => app.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? as(cookie) : {} });
  let staffA = '', admin = '';

  it('needs a login for pages and for every API call', async () => {
    expect((await get('/api/admin/state')).statusCode).toBe(401);
    expect((await post('/api/chat/start', { merchant: 'MERCH_A' })).statusCode).toBe(401);
    expect((await post('/api/analyze', { merchant: 'MERCH_A', text: 'hi' })).statusCode).toBe(401);
    for (const route of ['/admin', '/admin/kb', '/chat']) {                        // signed out: sent to the login page
      const page = await get(route);
      expect(page.statusCode).toBe(302); expect(page.headers.location).toBe('/login');
    }
    expect((await get('/admin.html')).headers.location).toBe('/admin');          // the old page addresses still work
    expect((await get('/login.html?x=1')).headers.location).toBe('/login?x=1');
    expect((await get('/health')).statusCode).toBe(200);                           // the health check stays open
    expect((await get('/login')).statusCode).not.toBe(302);                        // the login page itself is open (200 once the front end is built)
    expect((await get('/api/admin/state', 'aibot_session=tampered.value')).statusCode).toBe(401);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    expect((await login('luckypay', 'wrong')).status).toBe(401);
    expect((await login('nobody', 'whatever')).status).toBe(401);
    const a = await login('luckypay', DEMO_STAFF_PASSWORD);
    expect(a.status).toBe(200); expect(a.body.user).toEqual({ username: 'luckypay', role: 'staff', merchant: 'MERCH_A' });
    staffA = a.cookie;
    admin = (await login(DEMO_ADMIN.username, DEMO_ADMIN.password)).cookie;
    expect(staffA).toContain('aibot_session=');
    const me = (await get('/api/auth/me', staffA)).json();
    expect(me.user.merchant).toBe('MERCH_A');
  });

  it('staff see only their own merchant', async () => {
    const st = (await get('/api/admin/state', staffA)).json();
    expect(st.merchants.map((m: { code: string }) => m.code)).toEqual(['MERCH_A']);
    expect(new Set(st.snapshot.kb.map((e: { merchant: string }) => e.merchant))).toEqual(new Set(['MERCH_A']));
    expect(Object.keys(st.snapshot.settings)).toEqual(['MERCH_A']);
    expect(Object.keys(st.snapshot.mAliases)).toEqual(['MERCH_A']);
    const all = (await get('/api/admin/state', admin)).json();
    expect(all.merchants.length).toBe(seedJson.merchants.length); expect(Object.keys(all.snapshot.settings).length).toBe(seedJson.merchants.length);
    expect((await get('/api/merchants', staffA)).json().map((m: { code: string }) => m.code)).toEqual(['MERCH_A']);
    expect((await get('/api/merchants', admin)).json().length).toBe(seedJson.merchants.length);
  });

  it('staff cannot reach another merchant by any route', async () => {
    expect((await get('/api/admin/keywords?merchant=MERCH_B', staffA)).statusCode).toBe(403);
    expect((await get('/api/admin/keywords?merchant=MERCH_A', staffA)).statusCode).toBe(200);
    expect((await get('/api/admin/ranking?merchant=MERCH_B&week=0', staffA)).statusCode).toBe(403);
    expect((await get('/api/admin/keywords/samples?merchant=MERCH_B&word=dep', staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/keywords/ignore', { merchant: 'MERCH_B', words: ['lh'], ignored: true }, staffA)).statusCode).toBe(403);
    expect((await get('/api/keywords/summary?merchant=MERCH_B', staffA)).statusCode).toBe(403);
    expect((await post('/api/chat/start', { merchant: 'MERCH_B' }, staffA)).statusCode).toBe(403);
    expect((await post('/api/analyze', { merchant: 'MERCH_B', text: 'dep how' }, staffA)).statusCode).toBe(403);
    expect((await get('/api/admin/keywords?merchant=MERCH_B', admin)).statusCode).toBe(200);        // an admin may
  });

  it('staff can only roll back their own merchant, never the shared lists or another merchant; only an admin can reload', async () => {
    expect((await post('/api/admin/rollback', { merchant: null, version: 1 }, staffA)).statusCode).toBe(403);       // the shared word lists
    expect((await post('/api/admin/rollback', { merchant: 'MERCH_B', version: 1 }, staffA)).statusCode).toBe(403);  // another merchant
    expect((await post('/api/admin/rollback', { merchant: 'MERCH_A', version: 1 }, staffA)).statusCode).toBe(200);  // their own merchant is allowed
    expect((await post('/api/admin/rollback', { merchant: 'MERCH_A', version: 999 }, admin)).statusCode).toBe(404);
    expect((await post('/api/reload', {}, staffA)).statusCode).toBe(403);
    expect((await post('/api/reload', {}, admin)).statusCode).toBe(200);
  });

  it('a staff publish only changes their own entries, short forms, tone and messages, even if the request is edited by hand', async () => {
    const before = (await get('/api/admin/state', admin)).json();
    const full = before.snapshot;
    const mine = (await get('/api/admin/state', staffA)).json().snapshot;
    const hacked = JSON.parse(JSON.stringify(mine));
    hacked.kb.find((e: { intent_key: string }) => e.intent_key === 'deposit_how').translations.en.answer_text = 'STAFF EDIT';          // allowed
    hacked.settings.MERCH_A.tone = 'formal'; hacked.settings.MERCH_A.kind.en = 'Custom kind reply';                                    // allowed
    hacked.settings.MERCH_A.abuse_close_after = 1; hacked.settings.MERCH_A.handoff_group = 999; hacked.settings.MERCH_A.tools.points = false;   // admin only
    hacked.aliases.deposit.en.push('globalhack'); hacked.guard.abuse.en = [];                                                           // shared lists: admin only
    hacked.kb.push({ id: 7777, merchant: 'MERCH_B', category: 'x', intent_key: 'sneaky', topic: 'deposit', aspect: null, topic_optional: false, status: 'live', translations: { en: { question_examples: ['x'], answer_text: 'x' } } });   // another merchant
    hacked.settings.MERCH_B = { ...full.settings.MERCH_B, tone: 'formal' };                                                             // another merchant's settings
    const r = await post('/api/admin/publish', { snapshot: hacked, changes: ['Edited entry "deposit_how"'] }, staffA);
    expect(r.statusCode).toBe(200);

    const after = (await get('/api/admin/state', admin)).json();
    const a = after.snapshot.settings.MERCH_A;
    expect(after.snapshot.kb.find((e: { merchant: string; intent_key: string }) => e.merchant === 'MERCH_A' && e.intent_key === 'deposit_how').translations.en.answer_text).toBe('STAFF EDIT');
    expect(a.tone).toBe('formal'); expect(a.kind.en).toBe('Custom kind reply');
    expect(a.abuse_close_after).toBe(full.settings.MERCH_A.abuse_close_after);
    expect(a.handoff_group).toBe(full.settings.MERCH_A.handoff_group);
    expect(a.tools.points).toBe(full.settings.MERCH_A.tools.points);
    expect(after.snapshot.aliases.deposit.en).not.toContain('globalhack');
    expect(after.snapshot.guard.abuse.en.length).toBe(full.guard.abuse.en.length);
    expect(after.snapshot.kb.some((e: { intent_key: string }) => e.intent_key === 'sneaky')).toBe(false);
    expect(after.snapshot.settings.MERCH_B.tone).toBe(full.settings.MERCH_B.tone);
    const row = after.history.find((h: { actor: string }) => h.actor === 'luckypay');                                                    // the version records who published
    expect(row.merchant).toBe('MERCH_A');
    expect(after.versions.MERCH_A).toBe(before.versions.MERCH_A + 1);                                                                    // only their merchant got a new version
    expect(after.versions.MERCH_B).toBe(before.versions.MERCH_B);
    expect(after.sharedVer).toBe(before.sharedVer);
  });

  it('lists the messages the bot did not understand, lets staff deal with them, and keeps other merchants out', async () => {
    const list = (await get('/api/admin/unmatched?merchant=MERCH_A', staffA)).json() as { text: string; resolved: boolean; hits: number }[];
    expect(list.length).toBeGreaterThan(0); expect(list.every((r) => !r.resolved)).toBe(true);
    expect(list.map((r) => r.hits)).toEqual([...list.map((r) => r.hits)].sort((a, b) => b - a));            // most frequent first
    expect((await get('/api/admin/unmatched?merchant=MERCH_B', staffA)).statusCode).toBe(403);               // another merchant
    expect((await post('/api/admin/unmatched/resolve', { merchant: 'MERCH_B', texts: ['x'], resolution: 'ignored' }, staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/unmatched/resolve', { merchant: 'MERCH_A', texts: [list[0].text], resolution: 'nonsense' }, staffA)).statusCode).toBe(400);
    expect((await post('/api/admin/unmatched/resolve', { merchant: 'MERCH_A', texts: [list[0].text], resolution: 'ignored' }, staffA)).json().changed).toBe(1);
    const after = (await get('/api/admin/unmatched?merchant=MERCH_A', staffA)).json() as { text: string; resolved: boolean; resolution: string | null }[];
    expect(after.find((r) => r.text === list[0].text)).toMatchObject({ resolved: true, resolution: 'ignored' });
    expect(after[after.length - 1].text).toBe(list[0].text);                                                 // dealt-with ones go to the end
    await post('/api/admin/unmatched/resolve', { merchant: 'MERCH_A', texts: [list[0].text], resolution: null }, staffA);   // open it again
    expect(((await get('/api/admin/unmatched?merchant=MERCH_A', staffA)).json() as { resolved: boolean }[]).every((r) => !r.resolved)).toBe(true);
  });

  it('reports what the bot did, can leave the test chat out, and keeps other merchants out', async () => {
    const rep = async (qs: string, who = staffA) => (await get('/api/admin/report?merchant=MERCH_A&' + qs, who)).json();
    const r0 = await rep('days=7'), r30 = await rep('days=30');
    expect(r0.total).toBeGreaterThan(0); expect(r0.daily).toHaveLength(7); expect(r30.daily).toHaveLength(30); expect(r30.total).toBeGreaterThan(r0.total);
    expect(r0.helped + r0.notUnderstood + r0.handedOver + r0.rude).toBeLessThanOrEqual(r0.total);
    expect(r0.daily.reduce((a: number, d: { total: number }) => a + d.total, 0)).toBe(r0.total);
    expect(r0.topAnswers.length).toBeGreaterThan(0); expect(r0.topAnswers[0].n).toBeGreaterThanOrEqual(r0.topAnswers[r0.topAnswers.length - 1].n);
    expect(r0.tests).toBe(0);
    // a chat typed in the Test chat is counted as a test and can be left out
    const s = (await post('/api/chat/start', { merchant: 'MERCH_A' }, staffA)).json();
    await post('/api/chat/message', { sessionId: s.sessionId, text: 'depo how' }, staffA);
    await new Promise((r) => setTimeout(r, 300));
    const withTest = await rep('days=7'), liveOnly = await rep('days=7&test=0');
    expect(withTest.total).toBe(r0.total + 1); expect(withTest.tests).toBe(1);
    expect(liveOnly.total).toBe(r0.total);
    expect((await get('/api/admin/report?merchant=MERCH_B&days=7', staffA)).statusCode).toBe(403);
  });

  it('a staff test chat only knows their own merchant', async () => {
    const mine = (await get('/api/admin/state', staffA)).json().snapshot;
    const d = (await post('/api/admin/draft', { snapshot: mine, includeDrafts: false }, staffA)).json();
    expect((await get(`/api/merchants?draft=${d.draftId}`, staffA)).json().map((m: { code: string }) => m.code)).toEqual(['MERCH_A']);
  });

  it('locks out after repeated wrong passwords', async () => {
    await upsertUser(pool!, { username: 'locktest', password: 'rightpass', role: 'admin' });
    for (let i = 0; i < 5; i++) expect((await login('locktest', 'bad')).status).toBe(401);
    expect((await login('locktest', 'rightpass')).status).toBe(429);
  });

  it('creating a staff user needs an existing merchant', async () => {
    await expect(upsertUser(pool!, { username: 'w88', password: 'secret1', role: 'staff', merchant: 'W88' })).rejects.toThrow(/no merchant/);
    await upsertUser(pool!, { username: 'w88', password: 'secret1', role: 'staff', merchant: 'MERCH_C' });
    const w = await login('w88', 'secret1');
    expect(w.body.user.merchant).toBe('MERCH_C');
    await expect(upsertUser(pool!, { username: 'xx', password: 'short', role: 'admin' })).rejects.toThrow(/password/);
  });
});
