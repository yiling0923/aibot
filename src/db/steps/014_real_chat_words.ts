import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../pool';

/** One-time update from a study of real customer messages: bank and PayNow words (deposit), claim words (promotion), "done" and more hellos,
 *  and words that mean "please hurry / check for me" (hand to a person). Only adds what is missing. */
const ALIASES: [string, string][] = [['deposit', 'maybank'], ['deposit', 'mybank'], ['deposit', 'rhb'], ['deposit', 'ambank'], ['deposit', 'dbs'], ['deposit', 'ocbc'], ['deposit', 'posb'], ['deposit', 'paynow'],
  ['deposit', 'pay now'], ['deposit', 'uen'], ['deposit', 'cdm'], ['deposit', 'topap'], ['bank_account', 'acount num'], ['bank_account', 'acount number'],
  ['promotion', 'claim'], ['promotion', 'free spin'], ['promotion', 'free spins'], ['promotion', 'token']];
const SMALL: [string, string][] = [['ack', 'done'], ['greeting', 'halo'], ['greeting', 'helo'], ['greeting', 'hii'], ['greeting', 'hye']];
const GUARD: [string, string][] = ['tolonglh', 'help to approve', 'pls check', 'please check', 'kindly process', 'hurry', 'leave message'].map((w) => ['human_request', w]);

export async function addRealChatWords(pool: Pool): Promise<void> {
  const has = async (sql: string, args: string[]) => ((await pool.query<RowDataPacket[]>(sql, args))[0]).length > 0;
  for (const [canonical, variant] of ALIASES)
    if (!(await has("SELECT 1 FROM shared_aliases WHERE language = 'en' AND variant = ? AND canonical = ? LIMIT 1", [variant, canonical])))
      await pool.query("INSERT INTO shared_aliases(language, variant, canonical) VALUES('en', ?, ?)", [variant, canonical]);
  for (const [kind, phrase] of SMALL)
    if (!(await has("SELECT 1 FROM shared_smalltalk WHERE language = 'en' AND kind = ? AND phrase = ? LIMIT 1", [kind, phrase])))
      await pool.query("INSERT INTO shared_smalltalk(kind, language, phrase) VALUES(?, 'en', ?)", [kind, phrase]);
  for (const [kind, phrase] of GUARD)
    if (!(await has("SELECT 1 FROM shared_guard WHERE language = 'en' AND kind = ? AND phrase = ? LIMIT 1", [kind, phrase])))
      await pool.query("INSERT INTO shared_guard(kind, language, phrase) VALUES(?, 'en', ?)", [kind, phrase]);
}
