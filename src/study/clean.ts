import { createHash } from 'node:crypto';

/** One real customer question and the staff reply that followed it. */
export interface Pair { question: string; reply: string }

const unescapeTsv = (s: string) => s.replace(/\\(n|t|r|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'));

/** Splits text into rows of cells. Handles CSV (quotes, commas, new lines in quotes) and the tab separated text `mysql --batch` writes. */
export function parseRows(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const tsv = firstLine.includes('\t');                                                         // `mysql --batch` writes tabs; a CSV header has commas
  if (tsv) return t.split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t').map(unescapeTsv));
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.length)) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.length)) rows.push(row);
  return rows;
}

const Q_NAMES = ['question', 'customer', 'customer_message', 'customer_text', 'q', 'message', 'visitor'];
const R_NAMES = ['reply', 'answer', 'staff', 'staff_reply', 'agent', 'agent_reply', 'a', 'response', 'operator'];

/** Reads the question and reply columns. The header may name them (question, reply ...); without a header the first two columns are used. */
export function parsePairs(text: string): { pairs: Pair[]; error?: string } {
  const rows = parseRows(text);
  if (!rows.length) return { pairs: [], error: 'The file is empty.' };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const qi = head.findIndex((h) => Q_NAMES.includes(h)), ri = head.findIndex((h) => R_NAMES.includes(h));
  let body = rows, q = 0, r = 1;
  if (qi >= 0 && ri >= 0) { body = rows.slice(1); q = qi; r = ri; }
  else if (rows[0].length < 2) return { pairs: [], error: 'Each row needs two columns: the customer question and the staff reply (a header row "question,reply" is best).' };
  return { pairs: body.map((c) => ({ question: (c[q] ?? '').trim(), reply: (c[r] ?? '').trim() })) };
}

/**
 * Removes personal details: emails, phone and account numbers (a run of 8 or more digits), member ids (letters followed by 5 or more digits).
 * Names are NOT removed (they cannot be found reliably): look through the result before you rely on it.
 */
export function scrub(text: string): { text: string; changes: number } {
  let n = 0; const sub = (re: RegExp, to: string) => { text = text.replace(re, () => { n++; return to; }); };
  sub(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  sub(/\+?\d(?:[\s-]?\d){7,}/g, '[number]');
  sub(/\b[A-Za-z]{1,4}\d{5,}\b/g, '[id]');
  return { text: text.replace(/\s+/g, ' ').trim(), changes: n };
}

/** Lower case, no punctuation, one space between words: the form used to compare and to find duplicates. */
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const FILLER_REPLIES = new Set(['wait', 'please wait', 'hold on', 'a moment', 'one moment', 'hi', 'hello', 'hi there', 'alright', 'ok', 'okay', 'noted', 'thanks', 'thank you', 'sure', 'yes', 'no', 'done', 'ok done', 'tunggu', 'sekejap', 'sila tunggu', 'baik', 'terima kasih', '稍等', '好的', '谢谢', '请稍等', '收到']);
const FILLER_QUESTIONS = new Set(['hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'test', 'hai', 'helo', 'p', 'boss', 'bos', 'woi', 'oi']);
const FILE_NAME = /\.(jpe?g|png|gif|webp|heic|pdf|mp4|mov|docx?|xlsx?)$/i;

export type Drop = 'filler' | 'account' | 'short' | 'duplicate';
/** Why a pair is not useful for studying the bot, or null when it is. */
export function dropReason(question: string, reply: string): Drop | null {
  const nq = norm(question), nr = norm(reply);
  if (nq.length < 3 || FILLER_QUESTIONS.has(nq) || FILE_NAME.test(question.trim()) || /^\[(number|id|email)\]$/.test(question.trim())) return 'short';
  if (!nr || FILLER_REPLIES.has(nr) || nr.replace(/\s/g, '').length < 6 || FILE_NAME.test(reply.trim())) return 'filler';
  if (/\[(number|id|email)\]/.test(reply) || /\b(?:rm|myr|usd|sgd)\s?\d/i.test(reply) && /\b(done|credited|added|processed|approved|sudah|dah|已)\b/i.test(reply)) return 'account';       // a step done for one member, not an answer
  return null;
}

/** About 1 pair in 5 goes to the held-back test set. The same pair always lands on the same side. */
export const hashOf = (question: string, reply: string) => createHash('sha1').update(norm(question) + '\u0001' + norm(reply)).digest('hex');
export const splitOf = (hash: string): 'learn' | 'test' => (parseInt(hash.slice(0, 8), 16) % 5 === 0 ? 'test' : 'learn');

export interface Cleaned { pair: Pair; hash: string; split: 'learn' | 'test' }
export interface CleanStats { rows: number; kept: number; dropped: Record<Drop, number>; scrubbed: number; learn: number; test: number }

/** Scrubs, drops and removes duplicates. The result is what gets saved. */
export function cleanPairs(pairs: Pair[]): { kept: Cleaned[]; stats: CleanStats } {
  const stats: CleanStats = { rows: pairs.length, kept: 0, dropped: { filler: 0, account: 0, short: 0, duplicate: 0 }, scrubbed: 0, learn: 0, test: 0 };
  const seen = new Set<string>(); const kept: Cleaned[] = [];
  for (const p of pairs) {
    const q = scrub(p.question.slice(0, 1000)), r = scrub(p.reply.slice(0, 2000)); stats.scrubbed += q.changes + r.changes;
    const why = dropReason(q.text, r.text); if (why) { stats.dropped[why]++; continue; }
    const hash = hashOf(q.text, r.text); if (seen.has(hash)) { stats.dropped.duplicate++; continue; }
    seen.add(hash); const split = splitOf(hash); kept.push({ pair: { question: q.text, reply: r.text }, hash, split }); stats[split]++;
  }
  stats.kept = kept.length; return { kept, stats };
}
