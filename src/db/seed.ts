import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool, closePool, type Pool } from './pool';
import { hashPassword } from '../auth/passwords';
import { Tenants, ident, tbl } from './tenants';
import { allowWipe } from './guard';

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
async function seedPanelSamples(c: PoolConnection, dbs: Record<string, string>) {
  const panel = readJson('fake_panel.json') as {
    keywords: { w: string; n: number; c: number; lg: string; h: string; t: string }[];
    review: { unmatched: Record<string, [string, string, number, string][]>; handoff: Record<string, [string, string, string, string][]>; abuse: Record<string, [string, string, string, string][]> };
  };
  const weights = [0.02, 0.03, 0.02, 0.08, 0.22, 0.5, 0.13];
  const hash = (t: string) => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  for (const code of Object.keys(dbs)) {
    const D = (t: string) => tbl(dbs[code], t);
    for (const k of panel.keywords) {
      let total = 0;
      for (let week = 0; week < 5; week++) {
        const f = week === 0 ? 1 : 0.55 + 0.9 * ((hash(k.w + week) % 1000) / 1000);
        const n = Math.max(1, Math.round(k.n * f)); let left = n;
        for (let d = 0; d < 7; d++) {
          const hits = d === 6 ? left : Math.min(left, Math.round(n * weights[d] * (0.6 + 0.8 * ((hash(k.w + week + d) % 100) / 100))));
          left -= hits; total += hits;
          if (hits > 0) await c.query(`INSERT INTO ${D('keyword_daily')}(word,day,hits) VALUES(?,DATE_SUB(CURDATE(), INTERVAL ? DAY),?)`, [k.w, week * 7 + (6 - d), hits]);
        }
      }
      await c.query(`INSERT INTO ${D('keyword_store')}(word,language,hits,source,note,guess,first_seen) VALUES(?,?,?,'live',?,?,DATE_SUB(NOW(), INTERVAL 30 DAY))`, [k.w, k.lg, total, k.h, k.t]);
    }
    for (const [text, lang, hits, hint] of panel.review.unmatched[code] ?? [])
      await c.query(`INSERT INTO ${D('unmatched_messages')}(text,language,hits,suggestion) VALUES(?,?,?,?)`, [text, lang, hits, hint]);
    const session = (await c.query<ResultSetHeader>(`INSERT INTO ${D('chat_sessions')}(livechat_chat_id,language,status) VALUES(?,?,'closed')`, [`sample-${code}`, 'en']))[0].insertId;
    const ago = (label: string) => { const m = /^(Today|Yesterday)\s+(\d+):(\d+)/.exec(label); const d = new Date(); if (m) { if (m[1] === 'Yesterday') d.setDate(d.getDate() - 1); d.setHours(+m[2], +m[3], 0, 0); } else d.setDate(d.getDate() - (parseInt(label) || 2)); return d; };
    const add = async (text: string, decision: string, why: string, when: string) => {
      const mm = (await c.query<ResultSetHeader>(`INSERT INTO ${D('chat_messages')}(session_id,role,text) VALUES(?,?,?)`, [session, 'customer', text]))[0].insertId;
      await c.query(`INSERT INTO ${D('bot_decisions')}(message_id,decision,why,created_at) VALUES(?,?,?,?)`, [mm, decision, why, ago(when)]);
    };
    // a fortnight of fake traffic, so the Report screen has something to show on a fresh install
    const kbIds = (await c.query<RowDataPacket[]>(`SELECT id FROM ${D('kb_entries')} ORDER BY id`))[0].map((r) => Number(r.id));
    const mix: [string, number][] = [['ANSWER', 46], ['CHOICE', 9], ['SMALLTALK', 8], ['ACCOUNT', 7], ['AMOUNT', 4], ['REASK', 9], ['HANDOFF', 11], ['ABUSE', 2], ['REFUSE', 1], ['CLARIFY', 3]];
    const pickDecision = (n: number) => { let t = n % 100; for (const [d, w] of mix) { if (t < w) return d; t -= w; } return 'ANSWER'; };
    for (let day = 0; day < 14; day++) {
      const count = 14 + (hash(code + day) % 14);
      for (let i = 0; i < count; i++) {
        const decision = pickDecision(hash(code + day + 'd' + i));
        const matched = decision === 'ANSWER' && kbIds.length ? kbIds[(hash(code + 'k' + i + day) % Math.min(kbIds.length, 6))] : null;
        const mm = (await c.query<ResultSetHeader>(`INSERT INTO ${D('chat_messages')}(session_id,role,text) VALUES(?,?,?)`, [session, 'customer', `sample message ${day}-${i}`]))[0].insertId;
        const at = new Date(Date.now() - day * 86400000 - (hash(code + day + i) % 40000) * 1000);
        await c.query(`INSERT INTO ${D('bot_decisions')}(message_id,decision,matched_kb_id,why,created_at) VALUES(?,?,?,?,?)`, [mm, decision, matched, 'sample', at]);
      }
    }
    for (const [text, , why, when] of panel.review.handoff[code] ?? []) await add(text, 'HANDOFF', why, when);
    for (const [text, why, when, outcome] of panel.review.abuse[code] ?? []) await add(text, 'ABUSE', `${why} || ${outcome}`, when);
  }
}

/** Loads the fake template data (6 merchants) into an empty database. Safe to run again: it clears the data first,
 *  including every merchant database, and then creates one database per merchant. */
export async function seed(pool: Pool = getPool()) {
  const s = readJson('kb_seed.json'), acc = readJson('fake_accounts.json');
  const tenants = new Tenants(pool);

  // start clean: drop every merchant database, empty the shared tables
  for (const d of await tenants.allMerchantDbs()) await pool.query(`DROP DATABASE IF EXISTS ${ident(d)}`);
  const c0 = await pool.getConnection();
  try {
    await c0.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['admin_users', 'shared_versions', 'shared_aliases', 'shared_smalltalk', 'shared_guard', 'aspects', 'filler_words', 'kb_id_seq', 'merchants']) await c0.query(`TRUNCATE TABLE ${ident(t)}`);
    await c0.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally { c0.release(); }

  // the merchants, each with its own database (creating a database cannot be part of a transaction)
  const mid: Record<string, number> = {}, dbs: Record<string, string> = {};
  for (const m of s.merchants) {
    mid[m.code] = Number((await pool.query<ResultSetHeader>('INSERT INTO merchants(code,name,default_language,livechat_group_id,handoff_group_id) VALUES(?,?,?,?,?)',
      [m.code, m.name, m.default_language, m.livechat_group_id, m.handoff_group_id]))[0].insertId);
    dbs[m.code] = await tenants.ensure(m.code);
  }

  const c = await pool.getConnection();
  const ins = async (sql: string, params: unknown[] = []) => Number((await c.query<ResultSetHeader>(sql, params))[0].insertId);
  const run = async (sql: string, params: unknown[] = []) => { await c.query(sql, params); };
  try {
    await c.beginTransaction();
    for (const m of s.merchants) {
      const D = (t: string) => tbl(dbs[m.code], t);
      await run(`INSERT INTO ${D('settings')}(id,tone,closing_msg,handoff_msg,kind_reply) VALUES(1,?,?,?,?)`, [m.tone, JSON.stringify(m.settings.closing), JSON.stringify(m.settings.handoff), '{}']);
      for (const [language, variant, canonical] of m.aliases)
        await run(`INSERT INTO ${D('aliases')}(language,variant,canonical) VALUES(?,?,?)`, [language, variant, canonical]);
      for (const [kind, [lo, hi]] of Object.entries<[number, number]>(s.limits[m.code] ?? {}))
        await run(`INSERT INTO ${D('limits')}(kind,min_amount,max_amount) VALUES(?,?,?)`, [kind, lo, hi]);
      for (const tool of ['deposit_status', 'withdraw_status', 'balance', 'transactions', 'points'])
        await run(`INSERT INTO ${D('tools')}(tool,enabled) VALUES(?,?)`, [tool, tool.endsWith('_status') ? true : (acc._tools[m.code] ?? []).includes(tool)]);
    }
    // Shared words (all merchants) keep the order of the JSON file (it decides tie-breaks the same way as before).
    const words = async (table: string, cols: string, map: Record<string, Record<string, string[]>>) => {
      for (const [key, byLang] of Object.entries(map)) for (const [lang, list] of Object.entries(byLang)) for (const w of list)
        await run(`INSERT INTO ${table}(${cols}) VALUES(?,?,?)`, [key, lang, w]);
    };
    await words('shared_aliases', 'canonical,language,variant', s.global_aliases);
    await words('aspects', 'kind,language,keyword', s.aspects);
    await words('shared_smalltalk', 'kind,language,phrase', s.smalltalk);
    await words('shared_guard', 'kind,language,phrase', s.guard);
    for (const [lang, list] of Object.entries<string[]>(s.fillers)) for (const w of list)
      await run('INSERT INTO filler_words(language,word) VALUES(?,?)', [lang, w]);
    const cat: Record<string, number> = {};
    for (const e of s.kb_entries) {
      const D = (t: string) => tbl(dbs[e.merchant], t); const key = `${e.merchant}|${e.category}`;
      if (!(key in cat)) cat[key] = await ins(`INSERT INTO ${D('kb_categories')}(name) VALUES(?)`, [e.category]);
      const id = await ins('INSERT INTO kb_id_seq() VALUES()');                      // ids stay unique across all merchants
      await run(`INSERT INTO ${D('kb_entries')}(id,category_id,intent_key,title,topic,aspect,topic_optional) VALUES(?,?,?,?,?,?,?)`,
        [id, cat[key], e.intent_key, e.intent_key.replace(/_/g, ' '), e.topic ?? '', e.aspect ?? null, !!e.topic_optional]);
      for (const [lang, t] of Object.entries<any>(e.translations))
        await run(`INSERT INTO ${D('kb_translations')}(kb_id,language,question_examples,answer_text) VALUES(?,?,?,?)`, [id, lang, JSON.stringify(t.question_examples), t.answer_text]);
    }
    for (const ec of s.eval_cases) {
      const D = (t: string) => tbl(dbs[ec.merchant], t);
      const kb = ec.expected_intent ? ((await c.query<RowDataPacket[]>(`SELECT id FROM ${D('kb_entries')} WHERE intent_key=?`, [ec.expected_intent]))[0][0]?.id ?? null) : null;
      await run(`INSERT INTO ${D('eval_cases')}(message,language,expected_decision,expected_kb_id,expected_intent) VALUES(?,?,?,?,?)`, [ec.message, ec.language, ec.expected_decision, kb, ec.expected_intent ?? null]);
    }
    await seedPanelSamples(c, dbs);
    await seedUsers(c, mid, s.merchants);
    await c.commit();
    return { merchants: s.merchants.length, entries: s.kb_entries.length, evalCases: s.eval_cases.length };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts')) {
  const pool = getPool();
  allowWipe(pool, 'db:seed').then((ok) => (ok ? seed(pool).then((r) => console.log('seeded', r)) : undefined)).catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
}
