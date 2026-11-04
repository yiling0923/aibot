import 'dotenv/config';
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Engine, knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson, evalCases, judge } from './helpers';

const url = process.env.TEST_DATABASE_URL;
let pool: pg.Pool | null = null;
let reachable = false;
if (url) {
  pool = new pg.Pool({ connectionString: url, max: 4 });
  try { await pool.query('select 1'); reachable = true; } catch { /* tests below are skipped */ }
}
const d = describe.skipIf(!reachable);

d('database (needs TEST_DATABASE_URL, see README)', () => {
  let engine: Engine;
  beforeAll(async () => {
    await migrate(pool!, { reset: true });
    await seed(pool!);
    engine = new Engine(await loadKnowledge(pool!));
  });
  afterAll(async () => { await pool?.end(); });

  it('migrations are recorded', async () => {
    const r = await pool!.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(r.rows.map((x) => x.name)).toContain('001_init.sql');
  });

  it('seeds the three fake merchants and all acceptance cases', async () => {
    const c = async (t: string) => Number((await pool!.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
    expect(await c('merchants')).toBe(3);
    expect(await c('kb_entries')).toBe(seedJson.kb_entries.length);
    expect(await c('eval_cases')).toBe(evalCases.length);
    expect(await c('merchant_limits')).toBe(6);
  });

  it('loads the same knowledge as the seed file', async () => {
    const fromDb = await loadKnowledge(pool!), fromJson = knowledgeFromSeed(seedJson, accountsJson);
    const norm = (k: typeof fromDb) => ({
      merchants: k.merchants.map((m) => ({ ...m, tools: [...m.tools].sort(), kindReply: {} })),
      entries: k.kbEntries.map((e) => ({ m: e.merchant, key: e.intentKey, topic: e.topic, aspect: e.aspect, opt: e.topicOptional, tr: e.translations })),
      words: [k.globalAliases, k.smalltalk, k.aspects, k.guard, Object.fromEntries(Object.entries(k.fillers).filter(([, v]) => v.length))],   // an empty list is the same as no list
    });
    expect(norm(fromDb)).toEqual(norm(fromJson));
  });

  it('gives the same decisions for every acceptance case when reading from the database', () => {
    const failed = evalCases.filter((c) => !judge(engine.analyze(c.message, c.merchant, 0), c)).map((c) => `${c.merchant}: ${c.message}`);
    expect(failed).toEqual([]);
  });

  it('keeps merchants apart', async () => {
    for (const code of ['MERCH_A', 'MERCH_B', 'MERCH_C']) expect(engine.entriesOf(code).every((e) => e.merchant === code)).toBe(true);
    await expect(pool!.query(`INSERT INTO kb_entries(merchant_id,intent_key,topic) SELECT id,'deposit_how','deposit' FROM merchants WHERE code='MERCH_A'`)).rejects.toThrow(/unique/i);
    const a = engine.analyze('depo how', 'MERCH_A'), b = engine.analyze('depo how', 'MERCH_B');
    expect(a.top.id).not.toBe(b.top.id);                     // each merchant answers from its own entry
  });

  it('ignores draft entries until they are set live', async () => {
    const q = `UPDATE kb_entries SET status=$1 WHERE intent_key='promo_bonus' AND merchant_id=(SELECT id FROM merchants WHERE code='MERCH_A')`;
    await pool!.query(q, ['draft']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).not.toBe('ANSWER');
    await pool!.query(q, ['live']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).toBe('ANSWER');
  });

  it('can be seeded again', async () => { expect((await seed(pool!)).merchants).toBe(3); });
});
