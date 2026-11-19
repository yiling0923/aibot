import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { checklist, readiness, MIN_READY_ANSWERS, type SetupInput } from '../src/admin/setup';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { ask } from '../src/connector/ask';
import { Bot } from '../src/bot/responder';
import { Store } from '../src/bot/store';
import { loadKnowledge } from '../src/db/loadKnowledge';

const empty: SetupInput = { logins: 0, activeKeys: 0, keyLastUsed: null, entries: [], translations: [], chats: 0 };
const ex = JSON.stringify(['a b', 'c d', 'e f']);
const many = (n: number, answer = 'A real answer.') => ({ entries: Array.from({ length: n }, (_, i) => ({ id: i + 1, status: 'live', type: 'answer' })), translations: Array.from({ length: n }, (_, i) => ({ kb_id: i + 1, question_examples: ex, answer_text: answer })) });
const by = (r: ReturnType<typeof checklist>, key: string) => r.items.find((x) => x.key === key)!;

describe('how many answers are ready', () => {
  it('counts a live entry with a real answer and 3 example questions; not drafts, "TO WRITE", or too few examples', () => {
    const entries = [1, 2, 3, 4, 5, 6].map((id) => ({ id, status: id === 2 ? 'draft' : 'live', type: id === 6 ? 'needs_staff' : 'answer' }));
    const translations = [
      { kb_id: 1, question_examples: ex, answer_text: 'Fine.' },                          // ready
      { kb_id: 2, question_examples: ex, answer_text: 'Fine.' },                          // a draft
      { kb_id: 3, question_examples: ex, answer_text: 'TO WRITE: the rules' },            // not written
      { kb_id: 4, question_examples: JSON.stringify(['only one']), answer_text: 'Fine.' }, // too few examples
      { kb_id: 5, question_examples: ex, answer_text: '  ' },                              // no answer
      { kb_id: 6, question_examples: ex, answer_text: '' },                                // needs staff: the examples are enough
    ];
    expect(readiness(entries, translations)).toEqual({ liveReady: 2, drafts: 1, toWrite: 1, total: 6 });
  });
  it('an answer in another language counts too', () => {
    expect(readiness([{ id: 1, status: 'live', type: 'answer' }], [{ kb_id: 1, question_examples: JSON.stringify([]), answer_text: '' }, { kb_id: 1, question_examples: ex, answer_text: 'Jawapan.' }]).liveReady).toBe(1);
  });
});

describe('the setup checklist', () => {
  it('a brand new merchant has nothing done, and says what to do first', () => {
    const r = checklist(empty);
    expect(r.items.map((x) => [x.key, x.state])).toEqual([['login', 'todo'], ['key', 'todo'], ['livechat', 'todo'], ['answers', 'todo'], ['tried', 'todo'], ['mode', 'done']]);
    expect(r).toMatchObject({ done: 1, total: 6 });
    expect(by(r, 'answers').detail).toMatch(/No answers yet.*every question to a person.*starter pack/); expect(by(r, 'answers').action).toEqual({ to: 'imp', label: 'Open Import' });
    expect(by(r, 'livechat').detail).toMatch(/Make the bot key first/); expect(by(r, 'key').action?.to).toBe('key');
  });
  it('shows each step done when it is, ', () => {
    const r = checklist({ ...empty, logins: 1, activeKeys: 1, keyLastUsed: '2026-11-17T04:27:00.000Z', ...many(MIN_READY_ANSWERS), chats: 3 });
    expect(r.items.map((x) => [x.key, x.state])).toEqual([['login', 'done'], ['key', 'done'], ['livechat', 'done'], ['answers', 'done'], ['towrite', 'done'], ['tried', 'done'], ['mode', 'done']]);
    expect(r).toMatchObject({ done: 7, total: 7 }); expect(by(r, 'livechat').detail).toContain('2026-11-17 04:27');
  });
  it('asks for more answers below the minimum, and tells how many are drafts', () => {
    const m = many(3); m.entries[2].status = 'draft';
    const a = by(checklist({ ...empty, ...m }), 'answers'); expect(a.state).toBe('todo'); expect(a.detail).toMatch(/Only 2 live answers are ready.*at least 10.*1 is a draft/); expect(a.action?.to).toBe('kb');
  });
  it('shows "TO WRITE" as a step while any is left', () => {
    const m = many(MIN_READY_ANSWERS + 1, 'x'); m.translations[0].answer_text = 'TO WRITE: this one'; m.translations[1].answer_text = 'TO WRITE: and this';
    const t = by(checklist({ ...empty, ...m }), 'towrite'); expect(t.state).toBe('todo'); expect(t.detail).toMatch(/2 entries still say TO WRITE/);
  });
  it('has no account step: the bot does not read customer information', () => {
    expect(checklist(empty).items.map((x) => x.key)).not.toContain('account');
    expect(checklist(empty).total).toBe(6);
  });
  it('a merchant that only listens has a step to start answering', () => {
    const m = by(checklist({ ...empty, listening: true }), 'mode');
    expect(m).toMatchObject({ state: 'todo', title: 'Bot is listening', action: { to: 'learn', label: 'Open Learning' } });
    expect(by(checklist(empty), 'mode')).toMatchObject({ state: 'done', title: 'Bot is answering' });
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the checklist on the merchant page, step by step for a new merchant (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = '';
  const call = (method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie: admin } });
  const setup = async (code: string) => (await call('GET', `/api/admin/merchants/${code}/connection`)).json().setup as { items: { key: string; state: string; detail: string }[]; done: number; total: number };
  const st = (s: { items: { key: string; state: string }[] }, key: string) => s.items.find((x) => x.key === key)!.state;
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!); app = await buildApp({ pool: pool!, logger: false });
    admin = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('follows a new merchant from nothing to set up', async () => {
    expect((await call('POST', '/api/admin/merchants', { code: 'NEWCO', name: 'NewCo' })).statusCode).toBe(200);
    let s = await setup('NEWCO');
    expect(s.items.map((x) => x.state)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo', 'todo']); expect(s).toMatchObject({ done: 0, total: 6 });      // the last one: the new merchant starts by listening

    expect((await call('POST', '/api/admin/users', { username: 'newco', password: 'secret123', role: 'staff', merchant: 'NEWCO' })).statusCode).toBe(200);
    const key = (await call('POST', '/api/admin/merchants/NEWCO/bot-key', {})).json().key as string;
    s = await setup('NEWCO'); expect(st(s, 'login')).toBe('done'); expect(st(s, 'key')).toBe('done'); expect(st(s, 'livechat')).toBe('todo');

    const snap = await readSnapshot(pool!);                                                       // answers: 11 ready, 1 still says TO WRITE
    for (let i = 0; i < 11; i++) snap.kb.push({ id: 9000 + i, merchant: 'NEWCO', category: 'General', intent_key: 'ans_' + i, topic: 'deposit', aspect: null, topic_optional: false, status: 'live', translations: { en: { question_examples: ['deposit ' + i, 'depo ' + i, 'dep ' + i], answer_text: 'Answer ' + i } } });
    snap.kb.push({ id: 9100, merchant: 'NEWCO', category: 'General', intent_key: 'later', topic: 'bonus', aspect: null, topic_optional: false, status: 'draft', translations: { en: { question_examples: ['b1', 'b2', 'b3'], answer_text: 'TO WRITE: the bonus rules' } } });
    await writeSnapshot(pool!, snap, { merchants: ['NEWCO'], shared: false });
    s = await setup('NEWCO'); expect(st(s, 'answers')).toBe('done'); expect(st(s, 'towrite')).toBe('todo'); expect(s.items.find((x) => x.key === 'towrite')!.detail).toMatch(/1 entry still says TO WRITE/);

    const bot = new Bot(await loadKnowledge(pool!));                                              // LiveChat calls the bot with the key: connected, and a chat exists
    const { resolveKey } = await import('../src/connector/keys'); expect(await resolveKey(pool!, 'Bearer ' + key)).toBe('NEWCO');
    await ask({ pool: pool!, bot, store: new Store(pool!) }, 'NEWCO', { question: 'how long deposit take' });
    s = await setup('NEWCO'); expect(st(s, 'livechat')).toBe('done'); expect(st(s, 'tried')).toBe('done'); expect(st(s, 'login')).toBe('done');
    expect(s.done).toBe(5); expect(s.total).toBe(7);                                              // everything but the "TO WRITE" step and the switch to answering
    expect(st(s, 'mode')).toBe('todo'); expect(s.items.find((x) => x.key === 'tried')!.detail).toMatch(/1 chat so far/);   // a chat the bot only listened to counts
  });

  it('is for admins only', async () => {
    const staff = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'luckypay', password: (await import('../src/db/seed')).DEMO_STAFF_PASSWORD } })).headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/admin/merchants/MERCH_A/connection', headers: { cookie: staff } })).statusCode).toBe(403);
  });
});
