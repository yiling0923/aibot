import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { effectiveSnapshot } from '../src/admin/scope';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

const NOISE = ['blorp quux', 'zzz yyy www', 'hmm ooo ppp', 'flarg nib nab', 'qwx rtz mnb', 'vbn ghj kl'];
/** What the bot does with unclear messages, one after another in one chat, until a person takes over. */
async function run(times: number | undefined) {
  const k = knowledgeFromSeed(seedJson, accountsJson); const cfg = k.merchants.find((m) => m.code === 'MERCH_A')!; if (times !== undefined) cfg.reaskTimes = times;
  const bot = new Bot(k); const s = newSession('r' + Math.random(), 'MERCH_A', null); const out: string[] = [];
  for (const m of NOISE) { const t = (await bot.message(s, m))!; out.push(String(t.trace.decision)); if (s.handed) break; }
  return { out, s, bot };
}

describe('how many times the bot asks again before a person takes over', () => {
  it('asks once by default (the plan: ask once, then a person)', async () => {
    expect((await run(undefined)).out).toEqual(['REASK', 'HANDOFF']);
    expect((await run(1)).out).toEqual(['REASK', 'HANDOFF']);
  });
  it('0: a person takes over at the first message the bot does not understand', async () => { expect((await run(0)).out).toEqual(['HANDOFF']); });
  it('2 and 3: the bot asks that many times, then a person takes over', async () => {
    expect((await run(2)).out).toEqual(['REASK', 'REASK', 'HANDOFF']);
    expect((await run(3)).out).toEqual(['REASK', 'REASK', 'REASK', 'HANDOFF']);
  });
  it('a message the bot does understand starts the count again', async () => {
    const k = knowledgeFromSeed(seedJson, accountsJson); k.merchants.find((m) => m.code === 'MERCH_A')!.reaskTimes = 2;
    const bot = new Bot(k); const s = newSession('r-reset', 'MERCH_A', null); const d = async (m: string) => String((await bot.message(s, m))!.trace.decision);
    expect(await d(NOISE[0])).toBe('REASK'); expect(await d(NOISE[1])).toBe('REASK');                // two asks used
    expect(await d('how long does deposit take')).toBe('ANSWER');                                    // the customer is understood
    expect(await d(NOISE[2])).toBe('REASK'); expect(await d(NOISE[3])).toBe('REASK'); expect(await d(NOISE[4])).toBe('HANDOFF');   // two asks again, then a person
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the setting is saved, kept in range, loaded by the bot, and for admins only (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });
  const reload = async () => (await readSnapshot(pool!)).settings.MERCH_A.reask_times;
  const save = async (v: number) => { const s = await readSnapshot(pool!); s.settings.MERCH_A.reask_times = v; await writeSnapshot(pool!, s, { merchants: ['MERCH_A'], shared: false }); };

  it('is 1 for a new database, and 2 or 3 are saved and loaded by the bot', async () => {
    expect(await reload()).toBe(1); expect((await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_A')!.reaskTimes).toBe(1);
    await save(2); expect(await reload()).toBe(2); expect((await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_A')!.reaskTimes).toBe(2);
    await save(0); expect(await reload()).toBe(0);                                                  // 0 is a real value, not "missing"
  });
  it('keeps a bad number in range (0 to 3)', async () => {
    await save(9); expect(await reload()).toBe(3); await save(-4); expect(await reload()).toBe(0);
  });
  it('staff cannot change it, even by sending the request by hand', async () => {
    await save(1); const current = await readSnapshot(pool!); const mine = JSON.parse(JSON.stringify(current)); mine.settings.MERCH_A.reask_times = 3; mine.settings.MERCH_A.tone = 'formal';
    const staff = { username: 'luckypay', role: 'staff', merchant: 'MERCH_A' } as never;
    const eff = effectiveSnapshot(staff, current, mine);
    expect(eff.settings.MERCH_A.reask_times).toBe(1); expect(eff.settings.MERCH_A.tone).toBe('formal');   // the tone is allowed, the number is not
  });
});
