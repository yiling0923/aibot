import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../pool';
import { asJson } from '../pool';
import { Tenants, tbl } from '../tenants';

const NEW = ['vi', 'th', 'tl'] as const;
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/kb_seed.json');
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

/** One-time update for a database made before Vietnamese, Thai and Filipino existed. It only ADDS what is missing, and never changes anything a person wrote:
 *   1. the shared word lists (topic words, question words, greetings, rude words...) for each new language that has none yet;
 *   2. the closing and hand-off message of every merchant, for each new language it does not have;
 *   3. the new-language answers and example questions of the sample entries, only where the merchant's English answer is still the sample one.
 *  A new database does not need it: the sample data already has everything. */
export async function addLanguages(pool: Pool): Promise<void> {
  if (!fs.existsSync(SEED)) return;
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));

  // 1. shared word lists
  const lists: [string, string, Record<string, Record<string, string[]>>][] = [
    ['shared_aliases', 'canonical,language,variant', seed.global_aliases], ['aspects', 'kind,language,keyword', seed.aspects],
    ['shared_smalltalk', 'kind,language,phrase', seed.smalltalk], ['shared_guard', 'kind,language,phrase', seed.guard],
  ];
  for (const lang of NEW) {
    for (const [table, cols, map] of lists) {
      if ((await q(pool, `SELECT 1 FROM ${table} WHERE language = ? LIMIT 1`, [lang])).length) continue;
      for (const [key, byLang] of Object.entries(map)) for (const w of byLang[lang] ?? []) await pool.query(`INSERT INTO ${table}(${cols}) VALUES(?,?,?)`, [key, lang, w]);
    }
    if (!(await q(pool, 'SELECT 1 FROM filler_words WHERE language = ? LIMIT 1', [lang])).length)
      for (const w of seed.fillers?.[lang] ?? []) await pool.query('INSERT INTO filler_words(language,word) VALUES(?,?)', [lang, w]);
  }

  // 2 and 3: every merchant
  const sample = (tone: string) => seed.merchants.find((m: { tone: string }) => m.tone === tone) ?? seed.merchants[0];
  for (const t of await new Tenants(pool).list(true)) {
    try {
      const [st] = await q(pool, `SELECT tone, closing_msg, handoff_msg FROM ${tbl(t.db, 'settings')} WHERE id = 1`);
      if (st) {
        const src = sample(st.tone === 'formal' ? 'formal' : 'friendly').settings;
        const closing = asJson<Record<string, string>>(st.closing_msg, {}), handoff = asJson<Record<string, string>>(st.handoff_msg, {});
        let changed = false;
        for (const lang of NEW) {
          if (!closing[lang] && src.closing[lang]) { closing[lang] = src.closing[lang]; changed = true; }
          if (!handoff[lang] && src.handoff[lang]) { handoff[lang] = src.handoff[lang]; changed = true; }
        }
        if (changed) await pool.query(`UPDATE ${tbl(t.db, 'settings')} SET closing_msg = ?, handoff_msg = ? WHERE id = 1`, [JSON.stringify(closing), JSON.stringify(handoff)]);
      }
      for (const e of seed.kb_entries.filter((x: { merchant: string }) => x.merchant === t.code)) {
        const [row] = await q(pool, `SELECT k.id, tr.answer_text FROM ${tbl(t.db, 'kb_entries')} k JOIN ${tbl(t.db, 'kb_translations')} tr ON tr.kb_id = k.id AND tr.language = 'en' WHERE k.intent_key = ?`, [e.intent_key]);
        if (!row || row.answer_text !== e.translations.en.answer_text) continue;          // the merchant changed the English answer: its facts may differ now, so nothing is added
        for (const lang of NEW) {
          const x = e.translations[lang]; if (!x) continue;
          if ((await q(pool, `SELECT 1 FROM ${tbl(t.db, 'kb_translations')} WHERE kb_id = ? AND language = ?`, [row.id, lang])).length) continue;
          await pool.query(`INSERT INTO ${tbl(t.db, 'kb_translations')}(kb_id, language, question_examples, answer_text) VALUES(?,?,?,?)`, [row.id, lang, JSON.stringify(x.question_examples), x.answer_text]);
        }
      }
    } catch (e) { console.warn(`languages: could not update ${t.db}: ${(e as Error).message}`); }
  }
}
