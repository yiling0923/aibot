import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Engine } from '../src/engine';
import { readMerchants, readSnapshot, writeSnapshot, knowledgeFromSnapshot, type Snapshot } from '../src/admin/snapshot';
import { runTests } from '../src/admin/routes';
import { evalCases, judge } from './helpers';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let reachable = false;
if (url) { pool = createPool(url, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

const strip = (s: Snapshot) => ({ ...s, kb: s.kb.map(({ updated, id, ...e }) => e) });
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe.skipIf(!reachable)('control panel data (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });

  it('saving what was read changes nothing', async () => {
    const before = await readSnapshot(pool!);
    await writeSnapshot(pool!, clone(before));
    expect(strip(await readSnapshot(pool!))).toEqual(strip(before));
    const engine = new Engine(await loadKnowledge(pool!));
    expect(evalCases.filter((c) => !judge(engine.analyze(c.message, c.merchant, 0), c))).toEqual([]);
  });

  it('a snapshot gives the engine the same decisions as the database', async () => {
    const snap = await readSnapshot(pool!);
    const known = await loadKnowledge(pool!);
    const limits = Object.fromEntries(known.merchants.map((m) => [m.code, m.limits]));
    const fromSnap = new Engine(knowledgeFromSnapshot(snap, await readMerchants(pool!), limits, false));
    const failed = evalCases.filter((c) => !judge(fromSnap.analyze(c.message, c.merchant, 0), c));
    expect(failed).toEqual([]);
    const results = await runTests(pool!, fromSnap);
    expect(results.length).toBe(evalCases.length); expect(results.every((r) => r.ok)).toBe(true);
  });

  it('adds, edits and removes entries, keeps merchants apart, and keeps ids of untouched entries', async () => {
    const snap = await readSnapshot(pool!);
    const keep = snap.kb.find((e) => e.merchant === 'MERCH_A' && e.intent_key === 'deposit_how')!;
    const next = clone(snap);
    next.kb = next.kb.filter((e) => !(e.merchant === 'MERCH_A' && e.intent_key === 'promo_bonus'));          // removed
    next.kb.find((e) => e.id === keep.id)!.translations.en!.answer_text = 'NEW ANSWER';                      // edited
    next.kb.push({ id: 9999, merchant: 'MERCH_B', category: 'General', intent_key: 'refund_how', topic: 'deposit', aspect: 'how', topic_optional: false, status: 'live',
      translations: { en: { question_examples: ['refund how'], answer_text: 'Refunds take 3 days.' } } });   // added
    await writeSnapshot(pool!, next);
    const after = await readSnapshot(pool!);
    expect(after.kb.find((e) => e.intent_key === 'deposit_how' && e.merchant === 'MERCH_A')!.id).toBe(keep.id);
    expect(after.kb.find((e) => e.intent_key === 'deposit_how' && e.merchant === 'MERCH_A')!.translations.en!.answer_text).toBe('NEW ANSWER');
    expect(after.kb.some((e) => e.merchant === 'MERCH_A' && e.intent_key === 'promo_bonus')).toBe(false);
    expect(after.kb.find((e) => e.intent_key === 'refund_how')!.merchant).toBe('MERCH_B');
    const engine = new Engine(await loadKnowledge(pool!));
    expect(engine.entriesOf('MERCH_B').some((e) => e.intentKey === 'refund_how')).toBe(true);
    expect(engine.entriesOf('MERCH_A').some((e) => e.intentKey === 'refund_how')).toBe(false);
  });

  it('settings, tools, keywords and fillers are saved', async () => {
    const next = await readSnapshot(pool!);
    next.settings.MERCH_A.tone = 'formal'; next.settings.MERCH_A.abuse_close_after = 1; next.settings.MERCH_A.tools.points = false; next.settings.MERCH_A.handoff_group = 555;
    next.aliases.deposit.en!.push('topupz'); next.fillers.en = [...(next.fillers.en ?? []), 'hehehe']; next.mAliases.MERCH_A.push({ language: 'en', variant: 'cashin', canonical: 'deposit' });
    await writeSnapshot(pool!, next);
    const k = await loadKnowledge(pool!); const a = k.merchants.find((m) => m.code === 'MERCH_A')!;
    expect(a.tone).toBe('formal'); expect(a.abuseCloseAfter).toBe(1); expect(a.tools).not.toContain('points'); expect(a.handoffGroupId).toBe(555);
    expect(k.globalAliases.deposit.en).toContain('topupz'); expect(k.fillers.en).toContain('hehehe');
    expect(new Engine(k).analyze('cashin how', 'MERCH_A').top.intent).toBe('deposit_how');
  });

  it('a save that fails half way changes nothing', async () => {
    const before = await readSnapshot(pool!);
    const bad = clone(before);
    bad.aliases.deposit.en!.push('shouldnotsave');                                  // written first
    bad.settings.MERCH_A.handoff_group = 'abc' as unknown as number;                // fails later, so everything must be undone
    await expect(writeSnapshot(pool!, bad)).rejects.toThrow();
    const after = await readSnapshot(pool!);
    expect(after.aliases.deposit.en).not.toContain('shouldnotsave');
    expect(strip(after)).toEqual(strip(before));
  });
});
