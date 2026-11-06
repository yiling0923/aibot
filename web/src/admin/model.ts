import type { Snapshot, SnapEntry, MerchantMeta } from '../../../src/admin/snapshotTypes';

export type { Snapshot, SnapEntry, MerchantMeta };
export const LANGS = ['en', 'ms', 'zh'] as const;
export type L = (typeof LANGS)[number];
export const LN: Record<string, string> = { en: 'EN', ms: 'MS', zh: 'ZH' };

/** A knowledge base entry as the panel edits it: the server fields plus two display-only ones. */
export type Entry = SnapEntry & { dirty?: boolean };
export interface Draft extends Omit<Snapshot, 'kb'> { kb: Entry[] }
export interface MerchantRowAdmin { code: string; name: string; tone?: string; default_language?: string }
export interface Me { username: string; role: 'admin' | 'staff'; merchant: string | null }
export interface HistoryItem { kind: 'merchant' | 'shared'; merchant: string | null; version: number; actor: string; summary: string; ago: string }
export interface UnmatchedRow { text: string; language: string | null; hits: number; resolved: boolean; resolution: 'added' | 'ignored' | null; first: string; last: string }
export interface AiFlags { pick: boolean; write: boolean; describe: boolean; translate: boolean }

export interface KwRow { w: string; n: number; lg: string; h: string; isNew?: boolean; ignored?: boolean; first?: string; last?: string; lastTs?: number; from?: string; guess?: string; live?: number }
export interface RankRow { w: string; n: number; c: number; lg: string; h: string; series: number[]; live?: number }
export interface RankData { rows: RankRow[]; total: number; from: string; to: string }
export interface TestResult { message: string; merchant: string; expected: string; expIntent?: string; got: string; gotIntent?: string; ok: boolean }

export const ASPECT_LABEL: Record<string, string> = {
  time: 'time: how long it takes', limit: 'limit: minimum or maximum', how: 'how: how to do it', change: 'change: update or fix',
  hours: 'hours: opening hours', problem: 'problem: rejected, failed, complaint (goes to a human)', help: 'help: what to do (ignored)',
};

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const isZh = (w: string) => /[一-鿿]/.test(w);

export function agoISO(iso?: string): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hours ago' : Math.round(s / 86400) + ' days ago';
}

/** What the server stores: the draft without the display-only fields. */
export function snapshotOf(d: Draft): Snapshot {
  return { kb: d.kb.map(({ dirty: _d, updated: _u, ...e }) => e), aliases: d.aliases, mAliases: d.mAliases, aspects: d.aspects, smalltalk: d.smalltalk, guard: d.guard, fillers: d.fillers, settings: d.settings };
}

export const langState = (e: { translations: Entry['translations'] }, l: string): 'on' | 'part' | '' => {
  const t = e.translations[l as L] || { answer_text: '', question_examples: [] };
  const a = (t.answer_text || '').trim(), n = (t.question_examples || []).length;
  return a && n >= 3 ? 'on' : a || n ? 'part' : '';
};

export const topicList = (d: Draft) => Object.keys(d.aliases).filter((k) => !['balance', 'transactions', 'points'].includes(k));

/* ---------- what each keyword is right now ---------- */
export interface Status { c: string; t: string }
export function kwStatus(d: Draft, merchant: string, w: string): Status {
  const lw = w.toLowerCase(); const has = (arr: unknown[]) => arr.some((x) => String(x).toLowerCase() === lw);
  for (const [k, byl] of Object.entries(d.aliases)) if (has(Object.values(byl).flat())) return { c: 'ok', t: 'Topic: ' + k };
  const ma = (d.mAliases[merchant] || []).find((a) => a.variant.toLowerCase() === lw); if (ma) return { c: 'ok', t: 'Topic: ' + ma.canonical + ' (this merchant)' };
  for (const [k, byl] of Object.entries(d.aspects)) if (has(Object.values(byl).flat())) return { c: 'ok', t: 'Question word: ' + k };
  for (const [k, byl] of Object.entries(d.smalltalk)) if (has(Object.values(byl).flat())) return { c: 'ok', t: 'Greeting list: ' + k };
  if (has(Object.values(d.fillers).flat())) return { c: 'ok', t: 'Filler' };
  if (has(Object.values(d.guard.abuse).flat())) return { c: 'bad', t: 'Rude word' };
  if (has(Object.values(d.guard.abuse_soft).flat())) return { c: 'warn', t: 'Rude word (mild)' };
  return { c: '', t: 'Not set yet' };
}
const typeOfStatus = (st: string) => (st === 'Filler' ? 'filler' : st.startsWith('Question word') ? 'question' : st.startsWith('Greeting') ? 'greeting' : st.startsWith('Rude') ? 'rude' : 'other');
export function classify(d: Draft, merchant: string, kw: Record<string, KwRow>, w: string): string {
  const st = kwStatus(d, merchant, w).t;
  if (st === 'Not set yet') return kw[w]?.guess || 'other';
  if (st.startsWith('Topic:')) { const topic = st.slice(7).replace(' (this merchant)', ''); return w.toLowerCase() === topic ? 'topic' : 'slang'; }
  return typeOfStatus(st);
}

/** Where a word is already used, so the same word is never added twice. */
export function findDup(d: Draft, merchant: string, merchantName: string, w: string): string[] {
  const lw = w.toLowerCase(); const where: string[] = [];
  for (const [k, byl] of Object.entries(d.aliases)) for (const vs of Object.values(byl)) if (vs.some((x) => x.toLowerCase() === lw)) where.push('a short form of "' + k + '"');
  const ma = (d.mAliases[merchant] || []).find((a) => a.variant.toLowerCase() === lw); if (ma) where.push('a short form of "' + ma.canonical + '" for ' + merchantName);
  for (const [k, byl] of Object.entries(d.aspects)) if (Object.values(byl).flat().some((x) => x.toLowerCase() === lw)) where.push('a question word (' + k + ')');
  for (const [k, byl] of Object.entries(d.smalltalk)) if (Object.values(byl).flat().some((x) => x.toLowerCase() === lw)) where.push('a greeting phrase (' + k + ')');
  if (Object.values(d.fillers).flat().some((x) => x.toLowerCase() === lw)) where.push('a filler word');
  for (const k of ['abuse', 'abuse_soft']) if (Object.values(d.guard[k]).flat().some((x) => x.toLowerCase() === lw)) where.push('a rude word');
  return where;
}

/** Takes a word out of whatever list it is in. */
export function unassign(d: Draft, merchant: string, w: string) {
  const lw = w.toLowerCase();
  const rm = (arr: string[]) => { const i = arr.findIndex((x) => String(x).toLowerCase() === lw); if (i >= 0) arr.splice(i, 1); };
  Object.values(d.aliases).forEach((byl) => Object.values(byl).forEach(rm));
  d.mAliases[merchant] = (d.mAliases[merchant] || []).filter((a) => a.variant.toLowerCase() !== lw);
  Object.values(d.aspects).forEach((byl) => Object.values(byl).forEach(rm)); Object.values(d.smalltalk).forEach((byl) => Object.values(byl).forEach(rm));
  Object.values(d.fillers).forEach(rm); ['abuse', 'abuse_soft'].forEach((k) => Object.values(d.guard[k]).forEach(rm));
}

export const pushUnique = (obj: Record<string, string[]>, k: string, w: string) => {
  obj[k] = obj[k] || [];
  if (!obj[k].map((x) => x.toLowerCase()).includes(w)) obj[k].push(w);
};

/* ---------- import ---------- */
const COLS: Record<string, string[]> = { intent_key: ['intent_key', 'entry', 'entry_name', 'name'], topic: ['topic', 'topic_word'], aspect: ['question_type', 'aspect', 'type'], language: ['language', 'lang'], examples: ['question_examples', 'examples', 'questions'], answer: ['answer_text', 'answer'], merchant: ['merchant'], optional: ['topic_optional', 'alone'], topicwords: ['topic_short_forms', 'short_forms'] };
export const COL_NAMES = COLS;
const LANGMAP: Record<string, string> = { en: 'en', english: 'en', ms: 'ms', bm: 'ms', malay: 'ms', 'bahasa melayu': 'ms', zh: 'zh', cn: 'zh', chinese: 'zh', 中文: 'zh' };

export function parseTable(src: string): string[][] {
  const text = src.replace(/^﻿/, ''); const first = text.split(/\r?\n/)[0] || ''; const d = first.includes('\t') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportGroup {
  key: string; raw: string; topic: string; aspect: string; optional: boolean; topicWords: string[];
  langs: Record<string, { answer: string; examples: string[] }>; issues: string[]; errors: string[]; dups: number; fixedName?: string;
  exists: boolean; existing?: Entry;
}
export interface ImportResult { entries: ImportGroup[]; skippedRows: number; fatal: string | null; rows: number }

export function analyzeImport(text: string, d: Draft, merchant: string, merchantName: string): ImportResult {
  const out: ImportResult = { entries: [], skippedRows: 0, fatal: null, rows: 0 }; if (!text.trim()) return out;
  const rows = parseTable(text); if (rows.length < 2) { out.fatal = 'The file needs a header row and at least one data row.'; return out; }
  const head = rows[0].map((h) => h.trim().toLowerCase()); const idx: Record<string, number> = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h));
  const miss = ['intent_key', 'language', 'answer'].filter((k) => idx[k] < 0);
  if (miss.length) { out.fatal = 'Missing column: ' + miss.map((k) => COLS[k][0]).join(', ') + '. Found: ' + head.join(', '); return out; }
  const groups = new Map<string, ImportGroup>(); const get = (r: string[], k: string) => (idx[k] < 0 ? '' : (r[idx[k]] || '').trim());
  rows.slice(1).forEach((r, ri) => {
    out.rows++;
    const mc = get(r, 'merchant'); if (mc && ![merchant.toLowerCase(), merchantName.toLowerCase()].includes(mc.toLowerCase())) { out.skippedRows++; return; }
    const raw = get(r, 'intent_key'); const key = slug(raw); const lg = LANGMAP[get(r, 'language').toLowerCase()];
    let g = groups.get(key || 'row' + ri);
    if (!g) { g = { key, raw, topic: '', aspect: '', optional: false, topicWords: [], langs: {}, issues: [], errors: [], dups: 0, exists: false }; groups.set(key || 'row' + ri, g); }
    if (!key) { g.errors.push('Row ' + (ri + 2) + ': entry name is empty'); return; }
    if (raw !== key) g.fixedName = raw;
    if (!lg) { g.errors.push('Row ' + (ri + 2) + ': unknown language "' + get(r, 'language') + '" (use en, ms or zh)'); return; }
    if (g.langs[lg]) g.dups++;
    g.langs[lg] = { answer: get(r, 'answer'), examples: [...new Set(get(r, 'examples').split(/\s*\|\s*|\n/).map((x) => x.trim()).filter(Boolean))] };
    if (!g.topic) g.topic = get(r, 'topic').toLowerCase();
    if (!g.aspect) g.aspect = get(r, 'aspect').toLowerCase().replace(/^(none|topic alone|-|—)$/, '');
    if (/^(yes|true|1|y)$/i.test(get(r, 'optional'))) g.optional = true;
    if (!g.topicWords.length) g.topicWords = get(r, 'topicwords').split(/\s*\|\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  });
  const topics = topicList(d);
  for (const g of groups.values()) {
    const ex = d.kb.find((e) => e.merchant === merchant && e.intent_key === g.key); g.exists = !!ex; g.existing = ex;
    if (!g.key) { out.entries.push(g); continue; }
    if (!g.langs.en || !g.langs.en.answer) g.errors.push('The English answer is required');
    LANGS.forEach((l) => {
      const x = g.langs[l];
      if (!x) { if (!(ex && (ex.translations[l] || { answer_text: '' }).answer_text)) g.issues.push(LN[l] + ' is missing'); return; }
      if (!x.answer) g.issues.push(LN[l] + ': answer is empty');
      if (x.examples.length < 3) g.issues.push(LN[l] + ': ' + x.examples.length + ' example question' + (x.examples.length === 1 ? '' : 's') + ' (3 or more is better)');
    });
    const topic = g.topic || (ex && ex.topic) || '';
    if (!topic) g.errors.push('A topic is required. Put it in the topic column.');
    else if (!topics.includes(topic)) g.issues.push('New topic word "' + topic + '" will be created' + (g.topicWords.length ? ' with ' + g.topicWords.length + ' short form' + (g.topicWords.length > 1 ? 's' : '') : '. Add short forms in Keywords.'));
    const asp = g.aspect || (ex && ex.aspect) || ''; if (asp && !d.aspects[asp]) g.issues.push('Unknown question type "' + asp + '"');
    if (g.dups) g.issues.push(g.dups + ' duplicate row' + (g.dups > 1 ? 's' : '') + ' for the same language (the last one is used)');
    if (g.fixedName) g.issues.push('Name changed to "' + g.key + '" (lowercase letters and underscores)');
    out.entries.push(g);
  }
  return out;
}

export const SAMPLE_CSV = `intent_key,topic,question_type,language,question_examples,answer_text
deposit_time,deposit,,en,"how long deposit take | dep not arrive | depo still pending | when deposit arrive","Deposits are usually credited within 3 minutes. If it takes longer, please send us your payment receipt."
deposit_time,deposit,,ms,"berapa lama deposit masuk | depo belum masuk | deposit lambat","Deposit biasanya dikreditkan dalam masa 3 minit. Jika lebih lama, sila hantar resit pembayaran anda."
daily_withdraw_limit,withdraw,,en,"daily withdraw limit | max wd per day | wd limit harian","You can withdraw up to MYR 50,000 per day."
daily_withdraw_limit,withdraw,,ms,"had pengeluaran harian | wd limit harian berapa | max wd sehari","Anda boleh mengeluarkan sehingga MYR 50,000 sehari."
daily_withdraw_limit,withdraw,,zh,"每日提款限额 | 一天最多提多少 | 提款每天限额","每天最多可提款MYR 50,000。"
refund_how,,,en,"refund how | how to get refund","Refunds are returned to your original payment method within 7 days."
Delete Account,account,,en,"how to delete account",""`;
export const TPL_HEAD = 'intent_key,topic,question_type,language,question_examples,answer_text\nexample_entry,deposit,time,en,"first example | second example | third example","The answer the bot may use, facts only."';
const csvCell = (v: string) => (/[",\n|]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
export function kbToCSV(entries: Entry[]): string {
  const rows = [['intent_key', 'topic', 'question_type', 'language', 'question_examples', 'answer_text', 'status']];
  entries.forEach((e) => LANGS.forEach((l) => { const t = e.translations[l]; if (t && (t.answer_text || t.question_examples.length)) rows.push([e.intent_key, e.topic || '', e.aspect || '', l, t.question_examples.join(' | '), t.answer_text, e.status]); }));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
