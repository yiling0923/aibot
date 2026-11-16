import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../pool';

/** One-time update: asking for the deposit bank account or PayNow QR goes to a person (these change often). Only adds what is missing. */
const WORDS: Record<string, string[]> = {'pay_method': ['paynow', 'pay now', 'uen', 'cdm', 'maybank', 'mybank', 'rhb', 'ambank', 'dbs', 'ocbc', 'posb', 'cimb', 'bank in', 'scan qr', 'qr code', 'qr'], 'pay_ask': ['bank acc', 'bank account', 'account number', 'acc no', 'acount num', 'acount number', 'account for', 'acc pls', 'account pls', 'nak acc', 'akaun bank', 'no akaun'], 'pay_deposit': ['deposit', 'depo', 'dp', 'top up', 'topup', 'topap', 'transfer', 'bank in', 'pay', 'bayar', 'top-up'], 'pay_except': ['withdraw', 'wd', 'withdrawal', 'tarik', 'cash out', 'change', 'update', 'bind', 'forgot', 'how to', 'how do', 'how can', 'cara', 'macam mana', 'bagaimana', 'failed', 'rejected', 'not received', 'belum masuk']};

export async function addPayInfoWords(pool: Pool): Promise<void> {
  for (const [kind, list] of Object.entries(WORDS))
    for (const phrase of list) {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM shared_guard WHERE language = 'en' AND kind = ? AND phrase = ? LIMIT 1", [kind, phrase]);
      if (!rows.length) await pool.query("INSERT INTO shared_guard(kind, language, phrase) VALUES(?, 'en', ?)", [kind, phrase]);
    }
}
