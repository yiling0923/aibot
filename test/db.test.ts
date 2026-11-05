import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { dbNameFor, tbl } from '../src/db/tenants';
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

  const dbOf = (code: string) => dbNameFor('livechat_bot_test', code);
  const count = async (code: string, table: string) => Number((await pool!.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${tbl(dbOf(code), table)}`))[0][0].n);

  it('every merchant has its own database with all its tables, and the main database holds only what is shared', async () => {
    const names = async (db: string) => (await pool!.query<RowDataPacket[]>('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [db]))[0].map((r) => r.t as string).sort();
    const main = await names('livechat_bot_test');
    expect(main).toEqual(expect.arrayContaining(['merchants', 'admin_users', 'aspects', 'filler_words', 'shared_aliases', 'shared_smalltalk', 'shared_guard', 'shared_versions']));
    for (const t of ['kb_entries', 'kb_translations', 'keyword_store', 'chat_messages', 'eval_cases', 'settings']) expect(main).not.toContain(t);     // merchant data is not in the main database
    const dbs = (await pool!.query<RowDataPacket[]>('SELECT code, db_name FROM merchants ORDER BY id'))[0];
    expect(dbs.map((r) => r.db_name)).toEqual(seedJson.merchants.map((m: { code: string }) => dbOf(m.code)));
    for (const r of dbs) {
      const own = await names(r.db_name);
      expect(own).toEqual(expect.arrayContaining(['kb_entries', 'kb_translations', 'keyword_store', 'keyword_daily', 'unmatched_messages', 'chat_sessions', 'chat_messages', 'bot_decisions', 'feedback', 'eval_cases', 'settings', 'limits', 'tools', 'aliases', 'versions']));
      const col = await pool!.query<RowDataPacket[]>("SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND column_name = 'merchant_id'", [r.db_name]);
      expect(col[0]).toHaveLength(0);                                              // inside a merchant database the database itself is the merchant
    }
  });

  it('entry ids never repeat across merchants, and each merchant keeps only its own entries', async () => {
    const all: number[] = [];
    for (const m of seedJson.merchants) {
      const ids = (await pool!.query<RowDataPacket[]>(`SELECT id FROM ${tbl(dbOf(m.code), 'kb_entries')}`))[0].map((r) => Number(r.id)); all.push(...ids);
      expect(ids.length).toBe(seedJson.kb_entries.filter((e: { merchant: string }) => e.merchant === m.code).length);
    }
    expect(new Set(all).size).toBe(all.length);
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
    await expect(pool!.query(`INSERT INTO ${tbl(dbOf('MERCH_A'), 'kb_entries')}(intent_key,topic) VALUES('deposit_how','deposit')`)).rejects.toThrow(/duplicate/i);   // a name is used once inside a merchant, but may repeat in another merchant
    const a = engine.analyze('depo how', 'MERCH_A'), b = engine.analyze('depo how', 'MERCH_B');
    expect(a.top.id).not.toBe(b.top.id);                     // each merchant answers from its own entry
  });

  it('ignores draft entries until they are set live', async () => {
    const q = `UPDATE ${tbl(dbOf('MERCH_A'), 'kb_entries')} SET status=? WHERE intent_key='promo_bonus'`;
    await pool!.query(q, ['draft']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).not.toBe('ANSWER');
    await pool!.query(q, ['live']);
    expect(new Engine(await loadKnowledge(pool!)).analyze('any promo for new member?', 'MERCH_A').decision).toBe('ANSWER');
  });

  it('can be seeded again', async () => { expect((await seed(pool!)).merchants).toBe(seedJson.merchants.length); });
});
