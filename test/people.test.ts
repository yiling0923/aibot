import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { seedJson } from './helpers';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let reachable = false;
if (url) { pool = createPool(url, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('merchants and logins (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance, admin = '', staffA = '';
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); app = await buildApp({ pool: pool!, logger: false }); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  const login = async (username: string, password: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    return { status: r.statusCode, cookie: String(r.headers['set-cookie'] ?? '').split(';')[0], body: r.json() };
  };
  const post = (url: string, payload: object, cookie: string) => app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it('signs in', async () => { admin = (await login(DEMO_ADMIN.username, DEMO_ADMIN.password)).cookie; staffA = (await login('luckypay', DEMO_STAFF_PASSWORD)).cookie; expect(admin && staffA).toBeTruthy(); });

  it('only an admin can see or change merchants and logins', async () => {
    expect((await get('/api/admin/people', staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/merchants', { code: 'HACK', name: 'Hack' }, staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/users', { username: 'evil', password: 'secret1', role: 'admin' }, staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/users/password', { username: 'admin', password: 'newpass1' }, staffA)).statusCode).toBe(403);
    expect((await post('/api/admin/users/delete', { username: 'admin' }, staffA)).statusCode).toBe(403);
    expect((await login(DEMO_ADMIN.username, DEMO_ADMIN.password)).status).toBe(200);          // still the old password
  });

  it('adds a merchant with an empty knowledge base and its own login', async () => {
    const r = await post('/api/admin/merchants', { code: 'w88', name: 'W88', language: 'en', tone: 'formal', handoffGroup: 201, login: { username: 'w88', password: 'w88pass1' } }, admin);
    expect(r.statusCode).toBe(200); expect(r.json().code).toBe('W88');
    const people = (await get('/api/admin/people', admin)).json();
    const w = people.merchants.find((m: { code: string }) => m.code === 'W88');
    expect(w).toMatchObject({ name: 'W88', entries: 0, tone: 'formal', handoffGroup: 201, logins: ['w88'] });
    expect(people.merchants.length).toBe(seedJson.merchants.length + 1);

    const staff = await login('w88', 'w88pass1');
    expect(staff.status).toBe(200); expect(staff.body.user).toEqual({ username: 'w88', role: 'staff', merchant: 'W88' });
    const st = (await get('/api/admin/state', staff.cookie)).json();
    expect(st.merchants.map((m: { code: string }) => m.code)).toEqual(['W88']);
    expect(st.snapshot.kb).toEqual([]);
    expect(st.snapshot.settings.W88.tools).toMatchObject({ deposit_status: true, balance: false });
    expect(st.snapshot.settings.W88.handoff.en).toBeTruthy();                                     // the fixed messages are filled in
    expect((await get('/api/admin/keywords?merchant=MERCH_A', staff.cookie)).statusCode).toBe(403);
    expect((await get('/api/admin/keywords?merchant=W88', staff.cookie)).statusCode).toBe(200);
  });

  it('the new merchant\'s bot works: it asks again, then hands off', async () => {
    const c = (await login('w88', 'w88pass1')).cookie;
    const s = (await post('/api/chat/start', { merchant: 'W88' }, c)).json();
    expect(s.greeting.text).toContain('W88');
    expect((await post('/api/chat/message', { sessionId: s.sessionId, text: 'apa tu' }, c)).json().turn.trace.decision).toBe('REASK');
    expect((await post('/api/chat/message', { sessionId: s.sessionId, text: 'hmm blah blah' }, c)).json().turn.trace.decision).toBe('HANDOFF');
  });

  it('refuses a bad or duplicate merchant code and says why', async () => {
    expect((await post('/api/admin/merchants', { code: 'W88', name: 'Again' }, admin)).statusCode).toBe(409);
    expect((await post('/api/admin/merchants', { code: 'x', name: 'Short' }, admin)).statusCode).toBe(400);
    expect((await post('/api/admin/merchants', { code: 'has space', name: 'Bad' }, admin)).statusCode).toBe(400);
    expect((await post('/api/admin/merchants', { code: 'NONAME', name: '  ' }, admin)).statusCode).toBe(400);
    expect((await get('/api/admin/people', admin)).json().merchants.length).toBe(seedJson.merchants.length + 1);
  });

  it('each merchant has its own versions: a publish and a roll back never touch another merchant', async () => {
    const w = (await login('w88', 'w88pass1')).cookie;
    const st0 = (await get('/api/admin/state', admin)).json();
    const mine = (await get('/api/admin/state', w)).json().snapshot;
    mine.kb.push({ id: 1, merchant: 'W88', category: 'General', intent_key: 'deposit_how', topic: 'deposit', aspect: 'how', topic_optional: false, status: 'live', translations: { en: { question_examples: ['how to deposit'], answer_text: 'W88 deposit steps.' } } });
    mine.mAliases.W88 = [{ language: 'en', variant: 'topup88', canonical: 'deposit' }];
    const pub = (await post('/api/admin/publish', { snapshot: mine, changes: ['Added entry'] }, w)).json();
    expect(pub.published).toEqual([{ scope: 'merchant', code: 'W88', ver: st0.versions.W88 + 1 }]);   // only W88 got a version, not MERCH_A, not the shared lists

    // roll MERCH_A back to its first version: W88 keeps its entry and short form
    expect((await post('/api/admin/rollback', { merchant: 'MERCH_A', version: 1 }, admin)).statusCode).toBe(200);
    let snap = (await get('/api/admin/state', admin)).json().snapshot;
    expect(snap.kb.some((e: { merchant: string; intent_key: string }) => e.merchant === 'W88' && e.intent_key === 'deposit_how')).toBe(true);
    expect(snap.mAliases.W88.some((a: { variant: string }) => a.variant === 'topup88')).toBe(true);
    expect(snap.kb.filter((e: { merchant: string }) => e.merchant === 'MERCH_A').length).toBe(11);

    // roll W88 back to when it was added: its entry goes, the other merchants stay as they are
    expect((await post('/api/admin/rollback', { merchant: 'W88', version: 1 }, admin)).statusCode).toBe(200);
    snap = (await get('/api/admin/state', admin)).json().snapshot;
    expect(snap.kb.some((e: { merchant: string }) => e.merchant === 'W88')).toBe(false);
    expect(snap.kb.filter((e: { merchant: string }) => e.merchant === 'MERCH_A').length).toBe(11);
    expect((await get('/api/admin/state', admin)).json().versions.W88).toBe(st0.versions.W88 + 2);   // its publish and its own roll back (the MERCH_A roll back did not count)
  });

  it('creates, resets and removes logins, with safeguards', async () => {
    expect((await post('/api/admin/users', { username: 'amy', password: 'amypass1', role: 'staff', merchant: 'MERCH_B' }, admin)).statusCode).toBe(200);
    expect((await post('/api/admin/users', { username: 'amy', password: 'other123', role: 'staff', merchant: 'MERCH_B' }, admin)).statusCode).toBe(409);
    expect((await post('/api/admin/users', { username: 'bob', password: 'bobpass1', role: 'staff', merchant: 'NOPE' }, admin)).statusCode).toBe(400);
    expect((await post('/api/admin/users', { username: 'bob', password: 'abc', role: 'admin' }, admin)).statusCode).toBe(400);
    expect((await login('amy', 'amypass1')).body.user.merchant).toBe('MERCH_B');
    expect((await post('/api/admin/users/password', { username: 'amy', password: 'reset999' }, admin)).statusCode).toBe(200);
    expect((await login('amy', 'amypass1')).status).toBe(401); expect((await login('amy', 'reset999')).status).toBe(200);
    expect((await post('/api/admin/users/delete', { username: 'admin' }, admin)).statusCode).toBe(400);   // not yourself
    expect((await post('/api/admin/users/delete', { username: 'amy' }, admin)).statusCode).toBe(200);
    expect((await login('amy', 'reset999')).status).toBe(401);
    expect((await post('/api/admin/users/delete', { username: 'ghost' }, admin)).statusCode).toBe(404);
  });

  it('keeps at least one admin', async () => {
    await post('/api/admin/users', { username: 'boss2', password: 'boss2pass', role: 'admin' }, admin);
    const boss2 = (await login('boss2', 'boss2pass')).cookie;
    expect((await post('/api/admin/users/delete', { username: 'admin' }, boss2)).statusCode).toBe(200);    // two admins: one may go
    expect((await post('/api/admin/users/delete', { username: 'boss2' }, boss2)).statusCode).toBe(400);     // not yourself
  });

  it('anyone can change their own password, but only with the current one', async () => {
    const w = (await login('w88', 'w88pass1')).cookie;
    expect((await post('/api/auth/password', { current: 'wrong', password: 'brandnew1' }, w)).statusCode).toBe(403);
    expect((await post('/api/auth/password', { current: 'w88pass1', password: 'abc' }, w)).statusCode).toBe(400);
    expect((await post('/api/auth/password', { current: 'w88pass1', password: 'brandnew1' }, w)).statusCode).toBe(200);
    expect((await login('w88', 'w88pass1')).status).toBe(401); expect((await login('w88', 'brandnew1')).status).toBe(200);
  });
});
