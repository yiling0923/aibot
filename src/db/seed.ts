import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { getPool, closePool } from './pool';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

/** Loads the fake template data (3 merchants) into an empty database. Safe to run again: it clears the data first. */
export async function seed(pool: pg.Pool = getPool()) {
  const s = readJson('kb_seed.json'), acc = readJson('fake_accounts.json');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE feedback, bot_decisions, chat_messages, chat_sessions, eval_cases, kb_translations, kb_entries,
      kb_categories, aliases, aspects, smalltalk_phrases, guard_phrases, filler_words, merchant_tools, merchant_limits,
      merchant_settings, merchants RESTART IDENTITY CASCADE`);
    const mid: Record<string, number> = {};
    for (const m of s.merchants) {
      mid[m.code] = (await c.query('INSERT INTO merchants(code,name,default_language,livechat_group_id,handoff_group_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [m.code, m.name, m.default_language, m.livechat_group_id, m.handoff_group_id])).rows[0].id;
      await c.query('INSERT INTO merchant_settings(merchant_id,tone,closing_msg,handoff_msg) VALUES($1,$2,$3,$4)',
        [mid[m.code], m.tone, JSON.stringify(m.settings.closing), JSON.stringify(m.settings.handoff)]);
      for (const [language, variant, canonical] of m.aliases)
        await c.query('INSERT INTO aliases(merchant_id,language,variant,canonical) VALUES($1,$2,$3,$4)', [mid[m.code], language, variant, canonical]);
      for (const [kind, [lo, hi]] of Object.entries<[number, number]>(s.limits[m.code] ?? {}))
        await c.query('INSERT INTO merchant_limits(merchant_id,kind,min_amount,max_amount) VALUES($1,$2,$3,$4)', [mid[m.code], kind, lo, hi]);
      for (const tool of ['deposit_status', 'withdraw_status', 'balance', 'transactions', 'points'])
        await c.query('INSERT INTO merchant_tools(merchant_id,tool,enabled) VALUES($1,$2,$3)',
          [mid[m.code], tool, tool.endsWith('_status') ? true : (acc._tools[m.code] ?? []).includes(tool)]);
    }
    // Global words keep the order of the JSON file (it decides tie-breaks the same way as before).
    const words = async (table: string, cols: string, map: Record<string, Record<string, string[]>>) => {
      for (const [key, byLang] of Object.entries(map)) for (const [lang, list] of Object.entries(byLang)) for (const w of list)
        await c.query(`INSERT INTO ${table}(${cols}) VALUES($1,$2,$3)`, [key, lang, w]);
    };
    for (const [canonical, byLang] of Object.entries<Record<string, string[]>>(s.global_aliases))
      for (const [lang, list] of Object.entries(byLang)) for (const w of list)
        await c.query('INSERT INTO aliases(merchant_id,language,variant,canonical) VALUES(NULL,$1,$2,$3)', [lang, w, canonical]);
    await words('aspects', 'kind,language,keyword', s.aspects);
    await words('smalltalk_phrases', 'kind,language,phrase', s.smalltalk);
    await words('guard_phrases', 'kind,language,phrase', s.guard);
    for (const [lang, list] of Object.entries<string[]>(s.fillers)) for (const w of list)
      await c.query('INSERT INTO filler_words(language,word) VALUES($1,$2)', [lang, w]);
    const cat: Record<string, number> = {};
    for (const e of s.kb_entries) {
      const key = `${e.merchant}|${e.category}`;
      if (!(key in cat)) cat[key] = (await c.query('INSERT INTO kb_categories(merchant_id,name) VALUES($1,$2) RETURNING id', [mid[e.merchant], e.category])).rows[0].id;
      const kb = (await c.query(`INSERT INTO kb_entries(merchant_id,category_id,intent_key,title,topic,aspect,topic_optional)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [mid[e.merchant], cat[key], e.intent_key, e.intent_key.replace(/_/g, ' '), e.topic ?? '', e.aspect ?? null, !!e.topic_optional])).rows[0].id;
      for (const [lang, t] of Object.entries<any>(e.translations))
        await c.query(`INSERT INTO kb_translations(kb_id,language,question_examples,answer_text,tsv)
          VALUES($1,$2,$3,$4,to_tsvector('simple', array_to_string($3::text[],' ')||' '||$4))`, [kb, lang, t.question_examples, t.answer_text]);
    }
    for (const ec of s.eval_cases) {
      const kb = ec.expected_intent
        ? (await c.query('SELECT id FROM kb_entries WHERE merchant_id=$1 AND intent_key=$2', [mid[ec.merchant], ec.expected_intent])).rows[0]?.id ?? null : null;
      await c.query('INSERT INTO eval_cases(merchant_id,message,language,expected_decision,expected_kb_id) VALUES($1,$2,$3,$4,$5)',
        [mid[ec.merchant], ec.message, ec.language, ec.expected_decision, kb]);
    }
    await c.query('COMMIT');
    return { merchants: s.merchants.length, entries: s.kb_entries.length, evalCases: s.eval_cases.length };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  seed().then((r) => console.log('seeded', r)).catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
}
