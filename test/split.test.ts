import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { dbNameFor, tbl } from '../src/db/tenants';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }
const d = describe.skipIf(!reachable);

/** An installation made before every merchant had its own database: one shared set of tables, merchant_id on every row. */
d('upgrading an old single-database installation (needs TEST_DATABASE_URL)', () => {
  const q = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
  beforeAll(async () => {
    await migrate(pool!, { reset: true });
    // go back to the old layout: drop what the new migrations made, then run only the old files
    for (const db of (await q("SELECT schema_name AS n FROM information_schema.schemata WHERE schema_name LIKE 'livechat\\_bot\\_test\\_m\\_%'")).map((r) => r.n)) await pool!.query(`DROP DATABASE \`${db}\``);
    await pool!.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const r of await q('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()')) await pool!.query(`DROP TABLE \`${r.t}\``);
    await pool!.query('SET FOREIGN_KEY_CHECKS = 1');
    await pool!.query('CREATE TABLE schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const dir = path.resolve(__dirname, '../db/migrations');
    for (const f of fs.readdirSync(dir).filter((x) => /^00[1-6]_/.test(x)).sort()) { await pool!.query(fs.readFileSync(path.join(dir, f), 'utf8')); await pool!.query('INSERT INTO schema_migrations(name) VALUES(?)', [f]); }

    // two merchants with data in every kind of table
    await pool!.query(`INSERT INTO merchants(id,code,name) VALUES (1,'AAA','Alpha'),(2,'BBB','Beta')`);
    await pool!.query(`INSERT INTO merchant_settings(merchant_id,tone,closing_msg,handoff_msg,kind_reply) VALUES (1,'friendly','{}','{}','{}'),(2,'formal','{}','{}','{}')`);
    await pool!.query(`INSERT INTO merchant_limits VALUES (1,'deposit',10,1000),(2,'deposit',20,2000)`);
    await pool!.query(`INSERT INTO merchant_tools VALUES (1,'balance',true),(2,'points',true)`);
    await pool!.query(`INSERT INTO aliases(id,merchant_id,language,variant,canonical) VALUES (1,NULL,'en','depo','deposit'),(2,1,'en','topup','deposit'),(3,2,'en','dpt','deposit')`);
    await pool!.query(`INSERT INTO smalltalk_phrases(merchant_id,kind,language,phrase) VALUES (NULL,'thanks','en','thanks')`);
    await pool!.query(`INSERT INTO guard_phrases(merchant_id,kind,language,phrase) VALUES (NULL,'abuse','en','idiot')`);
    await pool!.query(`INSERT INTO aspects(kind,language,keyword) VALUES ('time','en','how long')`);
    await pool!.query(`INSERT INTO kb_categories(id,merchant_id,name) VALUES (1,1,'General'),(2,2,'General')`);
    await pool!.query(`INSERT INTO kb_entries(id,merchant_id,category_id,intent_key,topic) VALUES (10,1,1,'deposit_how','deposit'),(20,2,2,'deposit_how','deposit'),(21,2,2,'withdraw_how','withdraw')`);
    await pool!.query(`INSERT INTO kb_translations(id,merchant_id,kb_id,language,question_examples,answer_text) VALUES (1,1,10,'en','["a"]','Alpha answer'),(2,2,20,'en','["b"]','Beta answer')`);
    await pool!.query(`INSERT INTO eval_cases(merchant_id,message,language,expected_decision,expected_kb_id,expected_intent) VALUES (1,'depo how','en','ANSWER',10,'deposit_how')`);
    await pool!.query(`INSERT INTO keyword_store(merchant_id,word,language,hits) VALUES (1,'depo','en',5),(2,'depo','en',2)`);
    await pool!.query(`INSERT INTO keyword_daily(merchant_id,word,day,hits) VALUES (1,'depo',CURDATE(),5)`);
    await pool!.query(`INSERT INTO unmatched_messages(merchant_id,text,language) VALUES (2,'blah blah','en')`);
    await pool!.query(`INSERT INTO chat_sessions(id,merchant_id,livechat_chat_id) VALUES (1,1,'s1')`);
    await pool!.query(`INSERT INTO chat_messages(id,merchant_id,session_id,role,text) VALUES (1,1,1,'customer','hello')`);
    await pool!.query(`INSERT INTO bot_decisions(id,merchant_id,message_id,decision) VALUES (1,1,1,'ANSWER')`);
    await pool!.query(`INSERT INTO admin_users(username,password_hash,role,merchant_id) VALUES ('alpha','x','staff',1)`);
    await pool!.query(`INSERT INTO kb_versions(kind,merchant_id,version,actor,summary,snapshot) VALUES ('merchant',1,1,'system','start','{"x":1}'),('merchant',1,2,'a','edit','{"x":2}'),('merchant',2,1,'system','start','{}'),('shared',NULL,1,'system','start','{}'),('legacy',NULL,7,'old','old','{}')`);
    await migrate(pool!);                                                   // the upgrade
  });
  afterAll(async () => { await pool?.end(); });

  const db = (code: string) => dbNameFor('livechat_bot_test', code);
  it('gives every merchant its own database holding only its own rows, with the same ids', async () => {
    expect(await q(`SELECT intent_key, id FROM ${tbl(db('AAA'), 'kb_entries')} ORDER BY id`)).toEqual([expect.objectContaining({ intent_key: 'deposit_how', id: 10 })]);
    expect((await q(`SELECT intent_key FROM ${tbl(db('BBB'), 'kb_entries')} ORDER BY id`)).map((r) => r.intent_key)).toEqual(['deposit_how', 'withdraw_how']);
    expect((await q(`SELECT answer_text FROM ${tbl(db('BBB'), 'kb_translations')}`)).map((r) => r.answer_text)).toEqual(['Beta answer']);
    expect((await q(`SELECT variant FROM ${tbl(db('AAA'), 'aliases')}`)).map((r) => r.variant)).toEqual(['topup']);       // its own short forms only
    expect((await q(`SELECT variant FROM ${tbl(db('BBB'), 'aliases')}`)).map((r) => r.variant)).toEqual(['dpt']);
    expect(await q(`SELECT word, hits FROM ${tbl(db('AAA'), 'keyword_store')}`)).toEqual([expect.objectContaining({ word: 'depo', hits: 5 })]);
    expect(await q(`SELECT word, hits FROM ${tbl(db('BBB'), 'keyword_store')}`)).toEqual([expect.objectContaining({ word: 'depo', hits: 2 })]);
    expect((await q(`SELECT text FROM ${tbl(db('BBB'), 'unmatched_messages')}`)).map((r) => r.text)).toEqual(['blah blah']);
    expect((await q(`SELECT text FROM ${tbl(db('AAA'), 'chat_messages')}`)).map((r) => r.text)).toEqual(['hello']);
    expect(await q(`SELECT decision FROM ${tbl(db('AAA'), 'bot_decisions')}`)).toHaveLength(1);
    expect(await q(`SELECT expected_kb_id, expected_intent FROM ${tbl(db('AAA'), 'eval_cases')}`)).toEqual([expect.objectContaining({ expected_kb_id: 10, expected_intent: 'deposit_how' })]);
    expect(await q(`SELECT tone FROM ${tbl(db('BBB'), 'settings')}`)).toEqual([expect.objectContaining({ tone: 'formal' })]);
    expect((await q(`SELECT kind, CAST(max_amount AS DOUBLE) AS hi FROM ${tbl(db('BBB'), 'limits')}`))[0].hi).toBe(2000);
  });

  it('moves each merchant\'s versions into its own database and the shared ones into the main database; old full copies are dropped', async () => {
    expect((await q(`SELECT version FROM ${tbl(db('AAA'), 'versions')} ORDER BY version`)).map((r) => r.version)).toEqual([1, 2]);
    expect((await q(`SELECT version FROM ${tbl(db('BBB'), 'versions')}`)).map((r) => r.version)).toEqual([1]);
    expect((await q('SELECT version FROM shared_versions')).map((r) => r.version)).toEqual([1]);
  });

  it('keeps the shared words and the logins in the main database, and removes the old shared tables', async () => {
    expect((await q('SELECT variant FROM shared_aliases')).map((r) => r.variant)).toEqual(['depo']);
    expect((await q('SELECT phrase FROM shared_guard')).map((r) => r.phrase)).toEqual(['idiot']);
    expect((await q('SELECT phrase FROM shared_smalltalk')).map((r) => r.phrase)).toEqual(['thanks']);
    expect(await q('SELECT username FROM admin_users')).toEqual([expect.objectContaining({ username: 'alpha' })]);
    const left = (await q("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('kb_entries','keyword_store','chat_messages','merchant_settings','kb_versions')")).length;
    expect(left).toBe(0);
  });

  it('hands out new entry ids after the highest old one, and a second upgrade changes nothing', async () => {
    const id = Number((await pool!.query('INSERT INTO kb_id_seq() VALUES()'))[0] ? (await q('SELECT MAX(id) AS m FROM kb_id_seq'))[0].m : 0);
    expect(id).toBeGreaterThan(21);
    expect(await migrate(pool!)).toEqual([]);
  });
});
