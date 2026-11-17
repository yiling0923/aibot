import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { cleanSteps } from '../src/engine/steps';
import { seedJson, accountsJson } from './helpers';

const STEPS = [
  { kind: 'receipt', ask: { en: 'Please send the receipt picture.', ms: 'Sila hantar gambar resit.' } },
  { kind: 'amount', ask: { en: 'How much did you deposit?' } },
  { kind: 'username', ask: { en: 'What is your username?' } },
];
const texts = (t: { messages: { kind: string; text: string }[] }) => t.messages.filter((m) => m.kind === 'bot').map((m) => m.text);

describe('cleaning the steps', () => {
  it('keeps valid steps only, at most 3, trimmed, and drops a step with no text or an unknown kind', () => {
    const r = cleanSteps([{ kind: 'receipt', ask: { en: '  Send it  ', xx: 'no' } }, { kind: 'bogus', ask: { en: 'x' } }, { kind: 'amount', ask: {} }, { kind: 'phone', ask: { zh: '电话?' } }, { kind: 'text', ask: { en: 'a' } }, { kind: 'text', ask: { en: 'b' } }]);
    expect(r).toEqual([{ kind: 'receipt', ask: { en: 'Send it' } }, { kind: 'phone', ask: { zh: '电话?' } }, { kind: 'text', ask: { en: 'a' } }]);
    expect(cleanSteps('nope')).toEqual([]);
  });
});

describe('a guided answer', () => {
  const make = () => {
    const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson));
    bot.knowledge.kbEntries.find((e) => e.merchant === 'MERCH_A' && e.intentKey === 'deposit_time')!.steps = STEPS as never;
    return bot;
  };
  const say = async (bot: Bot, s: ReturnType<typeof newSession>, text: string, file = false) => { s.fileNext = file; const t = (await bot.message(s, text))!; s.fileNext = false; return t; };

  it('says the answer, asks for a receipt, an amount and a username, then hands over with the details as a note', async () => {
    const bot = make(), s = newSession('g1', 'MERCH_A', null);
    const a = await say(bot, s, 'how long deposit take');
    expect(texts(a)[0]).toMatch(/credited within 5 minutes/); expect(texts(a)[1]).toBe('Please send the receipt picture.');
    expect(a.cacheable).toBe(false); expect(s.guided).toMatchObject({ i: 0 });
    const again = await say(bot, s, 'later');                                                    // not a picture: asked once more
    expect(texts(again)[0]).toMatch(/picture of the receipt/); expect(texts(again)[0]).toMatch(/Please send the receipt picture\./);
    const pic = await say(bot, s, 'slip 1.png', true);                                           // a picture arrives (LiveChat tells the bot its name)
    expect(texts(pic)).toEqual(['How much did you deposit?']);
    const amt = await say(bot, s, 'i paid rm1,250.50 today');
    expect(texts(amt)).toEqual(['What is your username?']);
    const done = await say(bot, s, 'tom8841');
    expect(s.handed).toBe(true); expect(s.guided).toBeNull();
    expect(texts(done)[0]).toMatch(/passed your details to our team/);
    expect(done.handover!.reason).toMatch(/^Topic: deposit · Receipt: slip 1\.png · Amount: RM1,250\.5 · Username: tom8841$/);
    expect(done.handover!.collected.map((x) => x.kind)).toEqual(['receipt', 'amount', 'username']);
    expect(done.log).toMatchObject({ text: '[details]', decision: 'HANDOFF' });                  // the details are not kept in the logs
    expect((await say(bot, s, 'hello?')).trace.kind).toBe('skipped');                           // a person has the chat now
  });

  it('lets the customer skip a question, ask for a person, or start a new question', async () => {
    const bot = make();
    const s1 = newSession('g2', 'MERCH_A', null); await say(bot, s1, 'how long deposit take');
    await say(bot, s1, 'skip'); await say(bot, s1, 'skip'); const d = await say(bot, s1, 'skip');
    expect(d.handover!.reason).toBe('Topic: deposit · Receipt: skipped · Amount: skipped · Username: skipped');
    const s2 = newSession('g3', 'MERCH_A', null); await say(bot, s2, 'how long deposit take');
    const p = await say(bot, s2, 'agent'); expect(p.handover!.reason).toBe('Topic: deposit · Receipt: asked for a person'); expect(s2.handed).toBe(true);
    const s3 = newSession('g4', 'MERCH_A', null); await say(bot, s3, 'how long deposit take');
    const q = await say(bot, s3, 'how long does withdraw take');                                  // a new question is answered, the questions stop
    expect(s3.guided).toBeNull(); expect(s3.handed).toBe(false); expect(texts(q)[0]).toMatch(/30 minutes/);
  });

  it('asks again once, then moves on without the detail', async () => {
    const bot = make(), s = newSession('g5', 'MERCH_A', null); await say(bot, s, 'how long deposit take');
    await say(bot, s, 'skip');                                                                     // receipt skipped; now the amount
    const t1 = await say(bot, s, 'no idea'); expect(texts(t1)[0]).toMatch(/amount as a number/);
    const t2 = await say(bot, s, 'still no idea'); expect(texts(t2)).toEqual(['What is your username?']);     // gave up on the amount
    expect(s.guided!.got).toEqual([{ kind: 'receipt', value: 'skipped' }, { kind: 'amount', value: 'not given' }]);
  });

  it('an entry without steps answers as before', async () => {
    const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson)), s = newSession('g6', 'MERCH_A', null);
    const t = await say(bot, s, 'how long deposit take'); expect(texts(t)).toHaveLength(1); expect(s.guided ?? null).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('guided answers are saved, loaded, and sent through LiveChat (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });

  it('publishing a change to ONLY the questions, the type or the end date really saves it (staff of the merchant, through the panel route)', async () => {
    const app = await buildApp({ pool: pool!, logger: false });
    try {
      const staff = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'luckypay', password: DEMO_STAFF_PASSWORD } })).headers['set-cookie']).split(';')[0];
      const state = async () => (await app.inject({ method: 'GET', url: '/api/admin/state', headers: { cookie: staff } })).json().snapshot;
      const publish = (snapshot: unknown, note: string) => app.inject({ method: 'POST', url: '/api/admin/publish', payload: { snapshot, changes: [note] } as object, headers: { cookie: staff } });
      const find = (snap: { kb: { intent_key: string; steps?: unknown; entry_type?: string; ends_on?: string | null }[] }) => snap.kb.find((x) => x.intent_key === 'withdraw_time')!;
      let snap = await state(); find(snap).steps = STEPS;                                            // nothing else changed
      const r1 = (await publish(snap, 'Edited entry "withdraw_time"')).json(); expect(r1.published).toHaveLength(1);
      expect(find(await state()).steps).toEqual(STEPS);
      snap = await state(); find(snap).entry_type = 'promotion'; find(snap).ends_on = '2031-05-06';
      expect((await publish(snap, 'Edited entry "withdraw_time"')).json().published).toHaveLength(1);
      expect(find(await state())).toMatchObject({ entry_type: 'promotion', ends_on: '2031-05-06' });
      snap = await state(); find(snap).steps = undefined;                                            // removing the questions is a change too
      expect((await publish(snap, 'Edited entry "withdraw_time"')).json().published).toHaveLength(1);
      expect(find(await state()).steps).toBeUndefined();
      expect((await publish(await state(), 'No change')).json().published).toHaveLength(0);         // an untouched draft still publishes nothing
    } finally { await app.close(); }
  });

  it('saves the steps through the draft/publish path, cleans bad ones, and the bot loads them', async () => {
    const snap = await readSnapshot(pool!); const e = snap.kb.find((x) => x.merchant === 'MERCH_A' && x.intent_key === 'deposit_time')!;
    e.steps = [...STEPS, { kind: 'bogus', ask: { en: 'x' } }] as never;
    await writeSnapshot(pool!, snap, { merchants: ['MERCH_A'], shared: false });
    const back = (await readSnapshot(pool!)).kb.find((x) => x.merchant === 'MERCH_A' && x.intent_key === 'deposit_time')!;
    expect(back.steps).toEqual(STEPS);
    const k = (await loadKnowledge(pool!)).kbEntries.find((x) => x.merchant === 'MERCH_A' && x.intentKey === 'deposit_time')!;
    expect(k.steps).toEqual(STEPS);
    const other = (await loadKnowledge(pool!)).kbEntries.find((x) => x.merchant === 'MERCH_A' && x.intentKey !== 'deposit_time')!;
    expect(other.steps).toBeUndefined();
  });
});
