import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../pool';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/kb_seed.json');

/** One-time update: the "money" words (money, funds, duit, 钱, tiền, เงิน, pera) and the English ways to say a deposit has "not in". With them "my money not in"
 *  is a clear question about time with two possible topics, so the bot asks once ("deposit or withdrawal?") and then answers. Only adds what is missing. */
export async function addMoneyWords(pool: Pool): Promise<void> {
  if (!fs.existsSync(SEED)) return;
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const wanted: [string, string, string][] = [];
  for (const [lang, list] of Object.entries<string[]>(seed.aspects?.money ?? {})) for (const w of list) wanted.push(['money', lang, w]);
  for (const w of ['not in', 'not come in', 'not coming in', 'not credited', 'not showing', 'not reflected', 'not reflect']) wanted.push(['time', 'en', w]);
  for (const [kind, language, keyword] of wanted) {
    const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT 1 FROM aspects WHERE kind = ? AND language = ? AND keyword = ? LIMIT 1', [kind, language, keyword]);
    if (!rows.length) await pool.query('INSERT INTO aspects(kind, language, keyword) VALUES(?,?,?)', [kind, language, keyword]);
  }
}
