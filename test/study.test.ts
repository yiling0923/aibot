import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { Tenants, tbl } from '../src/db/tenants';
import { cleanPairs, dropReason, parsePairs, scrub, splitOf, hashOf } from '../src/study/clean';

describe('reading the exported chats', () => {
  it('reads a CSV with a header, quotes and new lines inside quotes', () => {
    const r = parsePairs('question,reply\n"how long, deposit?","Within 5 minutes.\nThank you"\nwithdraw time,30 minutes please');
    expect(r.pairs).toEqual([{ question: 'how long, deposit?', reply: 'Within 5 minutes.\nThank you' }, { question: 'withdraw time', reply: '30 minutes please' }]);
  });
  it('reads the tab separated text of mysql --batch, with its escapes', () => {
    const r = parsePairs('question\treply\nmy money not in\tPlease wait\\nwe check\nhello?\tHi');
    expect(r.pairs[0]).toEqual({ question: 'my money not in', reply: 'Please wait\nwe check' });
  });
  it('uses the first two columns when there is no header, and refuses a file with one column', () => {
    expect(parsePairs('a question here,an answer here').pairs).toEqual([{ question: 'a question here', reply: 'an answer here' }]);
    expect(parsePairs('only one column').error).toMatch(/two columns/);
    expect(parsePairs('').error).toMatch(/empty/);
  });
});

describe('cleaning', () => {
  it('removes emails, phone and account numbers and member ids, and says how many', () => {
    const r = scrub('my email is Tom@Example.com call +60 12-345 6789 acct 1234567890123 id M10023 amount RM50');
    expect(r.text).toBe('my email is [email] call [number] acct [number] id [id] amount RM50');
    expect(r.changes).toBe(4);
  });
  it('drops filler, short questions, files, and steps done for one member', () => {
    expect(dropReason('how long deposit take', 'wait')).toBe('filler');
    expect(dropReason('how long deposit take', 'Alright')).toBe('filler');
    expect(dropReason('hi', 'Deposits are usually credited within 5 minutes.')).toBe('short');
    expect(dropReason('MMU (3).jpg', 'Please wait, we are checking your slip.')).toBe('short');
    expect(dropReason('my money not in', 'Done, RM100 credited to your account')).toBe('account');
    expect(dropReason('how long deposit take', 'Deposits usually arrive within 3 to 5 minutes.')).toBeNull();
  });
  it('removes duplicates, and always puts the same pair on the same side, about 1 in 5 in the test set', () => {
    const pairs = Array.from({ length: 400 }, (_, i) => ({ question: `how to deposit number ${i}`, reply: 'Open Wallet then Deposit and follow the steps.' }));
    const a = cleanPairs([...pairs, ...pairs.slice(0, 50)]);
    expect(a.stats.dropped.duplicate).toBe(50); expect(a.kept).toHaveLength(400);
    expect(a.stats.learn + a.stats.test).toBe(400);
    expect(a.stats.test).toBeGreaterThan(40); expect(a.stats.test).toBeLessThan(130);
    const b = cleanPairs(pairs); expect(b.kept.map((k) => k.split)).toEqual(a.kept.map((k) => k.split));
    expect(splitOf(hashOf('x question', 'an answer'))).toBe(splitOf(hashOf('x  Question!', 'An answer')));
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the Study screen (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = '';
  const call = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: '/api/admin/merchants/' + path, payload: payload as object, headers: { cookie } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  const rows = () => ['question,reply',
    ...Array.from({ length: 80 }, (_, i) => `how long does deposit take ${i},Deposits are usually credited within 5 minutes after you pay.`),
    ...Array.from({ length: 40 }, (_, i) => `do you sell secret robots ${i},No we only run a game site. Please play responsibly.`),
    'hi,Hello', 'my money not in,Done RM100 credited to you'].join('\n');

  it('keeps other merchants out and needs text to import', async () => {
    expect((await call(staff, 'GET', 'MERCH_B/study')).statusCode).toBe(403);
    expect((await call(admin, 'POST', 'MERCH_A/study/import', { text: '' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', 'MERCH_A/study/import', { text: 'one column only' })).statusCode).toBe(400);
    const empty = await call(admin, 'POST', 'MERCH_A/study/import', { text: 'question\treply\n' });                  // an export with a header and no chats
    expect(empty.statusCode).toBe(400); expect(empty.json().error).toMatch(/PERSON \(an agent\) answered/);
  });

  it('cleans and saves, holds back about 1 in 5, and does not save the same pairs twice', async () => {
    const r = (await call(staff, 'POST', 'MERCH_A/study/import', { text: rows() })).json();
    expect(r.rows).toBe(122); expect(r.kept).toBe(120); expect(r.dropped.short + r.dropped.account + r.dropped.filler).toBe(2);
    expect(r.learn + r.test).toBe(120); expect(r.added).toBe(120);
    const again = (await call(staff, 'POST', 'MERCH_A/study/import', { text: rows() })).json();
    expect(again.added).toBe(0); expect(again.alreadySaved).toBe(120);
    const s = (await call(staff, 'GET', 'MERCH_A/study')).json();
    expect(s.total).toBe(120); expect(s.test).toBe(r.test);
  });

  it('measures the bot on the held-back pairs, and lists the gaps from the other pairs only', async () => {
    const m = (await call(staff, 'POST', 'MERCH_A/study/measure')).json();
    expect(m.tested).toBeGreaterThan(5);
    expect(m.coverage).toBeGreaterThan(0.3); expect(m.coverage).toBeLessThan(0.9);                 // the deposit questions are answered, the robot ones are not
    expect(m.accuracy).toBeGreaterThan(0.8); expect(m.scored).toBeGreaterThan(3);                  // the staff reply is the merchant's own deposit-time answer
    expect(m.wrongRate).toBeLessThanOrEqual(0.2);
    expect(m.noAnswerYet).toBeGreaterThan(0);                                                      // "we only run a game site" matches no answer of the merchant
    expect(m.gaps.length).toBeGreaterThan(0); expect(m.gaps[0].question).toMatch(/secret robots/); expect(m.gaps[0].reply).toMatch(/game site/);
    const db = (await new Tenants(pool!).get('MERCH_A'))!.db;
    const test = new Set((await pool!.query<import('mysql2/promise').RowDataPacket[]>(`SELECT question FROM ${tbl(db, 'study_pairs')} WHERE split = 'test'`))[0].map((x) => String(x.question)));
    for (const g of m.gaps) expect(test.has(g.question)).toBe(false);                              // a held-back question is never offered as a suggestion
  });

  it('can measure on every saved pair when none was held back, and says it is not a fair test', async () => {
    const all = (await call(staff, 'POST', 'MERCH_A/study/measure', { all: true })).json();
    expect(all.fair).toBe(false); expect(all.tested).toBe(120);
    expect((await call(staff, 'POST', 'MERCH_A/study/measure')).json().fair).toBe(true);
  });

  it('clears everything', async () => {
    expect((await call(staff, 'POST', 'MERCH_A/study/clear')).json().removed).toBe(120);
    expect((await call(staff, 'GET', 'MERCH_A/study')).json().total).toBe(0);
  });
});
