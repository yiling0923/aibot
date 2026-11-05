import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool, closePool, type Pool } from './pool';
import { hashPassword } from '../auth/passwords';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

/** Demo logins: one admin (all merchants) and one staff user per merchant (locked to that merchant). Change these before real use. */
export const DEMO_ADMIN = { username: 'admin', password: 'admin123' };
export const DEMO_STAFF_PASSWORD = 'demo123';
async function seedUsers(c: PoolConnection, mid: Record<string, number>, merchants: { code: string; name: string }[]) {
  await c.query('INSERT INTO admin_users(username, password_hash, role, merchant_id) VALUES(?,?,?,NULL)', [DEMO_ADMIN.username, hashPassword(DEMO_ADMIN.password), 'admin']);
  for (const m of merchants)
    await c.query('INSERT INTO admin_users(username, password_hash, role, merchant_id) VALUES(?,?,?,?)', [m.name.toLowerCase().replace(/[^a-z0-9]/g, ''), hashPassword(DEMO_STAFF_PASSWORD), 'staff', mid[m.code]]);
}

/** Fake traffic so the Keyword ranking screen has something to show on a fresh install. */
async function seedPanelSamples(c: PoolConnection, mid: Record<string, number>) {
  const panel = readJson('fake_panel.json') as {
    keywords: { w: string; n: number; c: number; lg: string; h: string; t: string }[];
    review: { unmatched: Record<string, [string, string, number, string][]>; handoff: Record<string, [string, string, string, string][]>; abuse: Record<string, [string, string, string, string][]> };
  };
  const weights = [0.02, 0.03, 0.02, 0.08, 0.22, 0.5, 0.13];
  const hash = (t: string) => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  for (const code of Object.keys(mid)) {
    for (const k of panel.keywords) {
      let total = 0;
      for (let week = 0; week < 5; week++) {
        const f = week === 0 ? 1 : 0.55 + 0.9 * ((hash(k.w + week) % 1000) / 1000);
        const n = Math.max(1, Math.round(k.n * f)); let left = n;
        for (let d = 0; d < 7; d++) {
          const hits = d === 6 ? left : Math.min(left, Math.round(n * weights[d] * (0.6 + 0.8 * ((hash(k.w + week + d) % 100) / 100))));
          left -= hits; total += hits;
          if (hits > 0) await c.query('INSERT INTO keyword_daily(merchant_id,word,day,hits) VALUES(?,?,DATE_SUB(CURDATE(), INTERVAL ? DAY),?)', [mid[code], k.w, week * 7 + (6 - d), hits]);
        }
      }
      await c.query("INSERT INTO keyword_store(merchant_id,word,language,hits,source,note,guess,first_seen) VALUES(?,?,?,?,'live',?,?,DATE_SUB(NOW(), INTERVAL 30 DAY))", [mid[code], k.w, k.lg, total, k.h, k.t]);
    }
    for (const [text, lang, hits, hint] of panel.review.unmatched[code] ?? [])
      await c.query('INSERT INTO unmatched_messages(merchant_id,text,language,hits,suggestion) VALUES(?,?,?,?,?)', [mid[code], text, lang, hits, hint]);
    const session = (await c.query<ResultSetHeader>("INSERT INTO chat_sessions(merchant_id,livechat_chat_id,language,status) VALUES(?,?,?,'closed')", [mid[code], `sample-${code}`, 'en']))[0].insertId;
    const ago = (label: string) => { const m = /^(Today|Yesterday)\s+(\d+):(\d+)/.exec(label); const d = new Date(); if (m) { if (m[1] === 'Yesterday') d.setDate(d.getDate() - 1); d.setHours(+m[2], +m[3], 0, 0); } else d.setDate(d.getDate() - (parseInt(label) || 2)); return d; };
    const add = async (text: string, decision: string, why: string, when: string) => {
      const mm = (await c.query<ResultSetHeader>('INSERT INTO chat_messages(session_id,role,text) VALUES(?,?,?)', [session, 'customer', text]))[0].insertId;
      await c.query('INSERT INTO bot_decisions(message_id,decision,why,created_at) VALUES(?,?,?,?)', [mm, decision, why, ago(when)]);
    };
    for (const [text, , why, when] of panel.review.handoff[code] ?? []) await add(text, 'HANDOFF', why, when);
    for (const [text, why, when, outcome] of panel.review.abuse[code] ?? []) await add(text, 'ABUSE', `${why} || ${outcome}`, when);
  }
}

/** Loads the fake template data (3 merchants) into an empty database. Safe to run again: it clears the data first. */
export async function seed(pool: Pool = getPool()) {
  const s = readJson('kb_seed.json'), acc = readJson('fake_accounts.json');
  const c = await pool.getConnection();
  const ins = async (sql: string, params: unknown[] = []) => Number((await c.query<ResultSetHeader>(sql, params))[0].insertId);
  const run = async (sql: string, params: unknown[] = []) => { await c.query(sql, params); };
  try {
    // TRUNCATE ends any transaction in MySQL, so clear the tables first (ids restart at 1), then load everything in one transaction.
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['admin_users', 'keyword_daily', 'kb_versions', 'keyword_store', 'unmatched_messages', 'feedback', 'bot_decisions', 'chat_messages', 'chat_sessions', 'eval_cases', 'kb_translations', 'kb_entries', 'kb_categories',
      'aliases', 'aspects', 'smalltalk_phrases', 'guard_phrases', 'filler_words', 'merchant_tools', 'merchant_limits', 'merchant_settings', 'merchants'])
      await c.query(`TRUNCATE TABLE ${t}`);
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
    await c.beginTransaction();
    const mid: Record<string, number> = {};
    for (const m of s.merchants) {
      mid[m.code] = await ins('INSERT INTO merchants(code,name,default_language,livechat_group_id,handoff_group_id) VALUES(?,?,?,?,?)',
        [m.code, m.name, m.default_language, m.livechat_group_id, m.handoff_group_id]);
      await run('INSERT INTO merchant_settings(merchant_id,tone,closing_msg,handoff_msg,kind_reply) VALUES(?,?,?,?,?)',
        [mid[m.code], m.tone, JSON.stringify(m.settings.closing), JSON.stringify(m.settings.handoff), '{}']);
      for (const [language, variant, canonical] of m.aliases)
        await run('INSERT INTO aliases(merchant_id,language,variant,canonical) VALUES(?,?,?,?)', [mid[m.code], language, variant, canonical]);
      for (const [kind, [lo, hi]] of Object.entries<[number, number]>(s.limits[m.code] ?? {}))
        await run('INSERT INTO merchant_limits(merchant_id,kind,min_amount,max_amount) VALUES(?,?,?,?)', [mid[m.code], kind, lo, hi]);
      for (const tool of ['deposit_status', 'withdraw_status', 'balance', 'transactions', 'points'])
        await run('INSERT INTO merchant_tools(merchant_id,tool,enabled) VALUES(?,?,?)',
          [mid[m.code], tool, tool.endsWith('_status') ? true : (acc._tools[m.code] ?? []).includes(tool)]);
    }
    // Global words keep the order of the JSON file (it decides tie-breaks the same way as before).
    const words = async (table: string, cols: string, map: Record<string, Record<string, string[]>>) => {
      for (const [key, byLang] of Object.entries(map)) for (const [lang, list] of Object.entries(byLang)) for (const w of list)
        await run(`INSERT INTO ${table}(${cols}) VALUES(?,?,?)`, [key, lang, w]);
    };
    for (const [canonical, byLang] of Object.entries<Record<string, string[]>>(s.global_aliases))
      for (const [lang, list] of Object.entries(byLang)) for (const w of list)
        await run('INSERT INTO aliases(merchant_id,language,variant,canonical) VALUES(NULL,?,?,?)', [lang, w, canonical]);
    await words('aspects', 'kind,language,keyword', s.aspects);
    await words('smalltalk_phrases', 'kind,language,phrase', s.smalltalk);
    await words('guard_phrases', 'kind,language,phrase', s.guard);
    for (const [lang, list] of Object.entries<string[]>(s.fillers)) for (const w of list)
      await run('INSERT INTO filler_words(language,word) VALUES(?,?)', [lang, w]);
    const cat: Record<string, number> = {};
    for (const e of s.kb_entries) {
      const key = `${e.merchant}|${e.category}`;
      if (!(key in cat)) cat[key] = await ins('INSERT INTO kb_categories(merchant_id,name) VALUES(?,?)', [mid[e.merchant], e.category]);
      const kb = await ins(`INSERT INTO kb_entries(merchant_id,category_id,intent_key,title,topic,aspect,topic_optional)
        VALUES(?,?,?,?,?,?,?)`,
        [mid[e.merchant], cat[key], e.intent_key, e.intent_key.replace(/_/g, ' '), e.topic ?? '', e.aspect ?? null, !!e.topic_optional]);
      for (const [lang, t] of Object.entries<any>(e.translations))
        await run('INSERT INTO kb_translations(kb_id,language,question_examples,answer_text) VALUES(?,?,?,?)',
          [kb, lang, JSON.stringify(t.question_examples), t.answer_text]);
    }
    for (const ec of s.eval_cases) {
      const kb = ec.expected_intent
        ? ((await c.query<RowDataPacket[]>('SELECT id FROM kb_entries WHERE merchant_id=? AND intent_key=?', [mid[ec.merchant], ec.expected_intent]))[0][0]?.id ?? null) : null;
      await run('INSERT INTO eval_cases(merchant_id,message,language,expected_decision,expected_kb_id,expected_intent) VALUES(?,?,?,?,?,?)',
        [mid[ec.merchant], ec.message, ec.language, ec.expected_decision, kb, ec.expected_intent ?? null]);
    }
    await seedPanelSamples(c, mid);
    await seedUsers(c, mid, s.merchants);
    await c.commit();
    return { merchants: s.merchants.length, entries: s.kb_entries.length, evalCases: s.eval_cases.length };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  seed().then((r) => console.log('seeded', r)).catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
}
