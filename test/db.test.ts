import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Engine, knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson, evalCases, judge } from './helpers';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let reachable = false;
if (url) {
  pool = createPool(url, 4);
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
    const [r] = await pool!.query<RowDataPacket[]>('SELECT name FROM schema_migrations ORDER BY name');
    expect(r.map((x) => x.name)).toContain('001_init.sql');
  });

  it('every row sits under a merchant, and the database refuses a row under the wrong merchant', async () => {
    const q = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
    for (const t of ['kb_translations', 'chat_messages', 'bot_decisions', 'feedback', 'kb_entries', 'keyword_store', 'chat_sessions'])
      expect(Number((await q(`SELECT COUNT(*) AS n FROM ${t} WHERE merchant_id IS NULL`))[0].n)).toBe(0);
    const [a, b] = (await q('SELECT id FROM merchants ORDER BY id')).map((r) => r.id);
    const [entry] = await q('SELECT id FROM kb_entries WHERE merchant_id = ? LIMIT 1', [a]);
    // an answer for merchant A's entry cannot be filed under merchant B
    await expect(pool!.query('INSERT INTO kb_translations(merchant_id,kb_id,language,question_examples,answer_text) VALUES(?,?,?,?,?)', [b, entry.id, 'xx', '[]', 'wrong'])).rejects.toThrow();
    // each merchant counts its own versions
    await pool!.query("INSERT INTO kb_versions(kind,merchant_id,version,actor,summary,snapshot) VALUES('merchant',?,1,'t','a','{}'),('merchant',?,1,'t','b','{}')", [a, b]);
    await expect(pool!.query("INSERT INTO kb_versions(kind,merchant_id,version,actor,summary,snapshot) VALUES('merchant',?,1,'t','dup','{}')", [a])).rejects.toThrow();
    await pool!.query("DELETE FROM kb_versions WHERE actor = 't'");
  });

  it('seeds the three fake merchants and all acceptance cases', async () => {
    const c = async (t: string) => Number((await pool!.query<RowDataPacket[]>(`SELECT count(*) AS n FROM ${t}`))[0][0].n);
    expect(await c('merchants')).toBe(seedJson.merchants.length);
    expect(await c('kb_entries')).toBe(seedJson.kb_entries.length);
    expect(await c('eval_cases')).toBe(evalCases.length);
    expect(await c('merchant_limits')).toBe(seedJson.merchants.length * 2);      // a deposit and a withdraw limit each
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
    await expect(pool!.query(`INSERT INTO kb_entries(merchant_id,intent_key,topic) SELECT id,'deposit_how','deposit' FROM merchants WHERE code='MERCH_A'`)).rejects.toThrow(/duplicate/i);
    const a = engine.analyze('depo how', 'MERCH_A'), b = engine.analyze('depo how', 'MERCH_B');
    expect(a.top.id).not.toBe(b.top.id);                     // each merchant answers from its own entry
  });

  it('ignores draft entries until they are set live', async () => {
    const q = `UPDATE kb_entries SET status=? WHERE intent_key='promo_bonus' AND merchant_id=(SELECT id FROM merchants WHERE code='MERCH_A')`;
    await pool!.query(q, ['draft']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).not.toBe('ANSWER');
    await pool!.query(q, ['live']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).toBe('ANSWER');
  });

  it('can be seeded again', async () => { expect((await seed(pool!)).merchants).toBe(seedJson.merchants.length); });
});
