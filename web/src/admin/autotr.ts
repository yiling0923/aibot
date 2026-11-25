import { api } from '../lib/api';
import { LANGS, LANG_NAMES, guessLang, type Entry, type MerchantRowAdmin } from './model';

export type Tr = { question_examples: string[]; answer_text: string; ai?: boolean };
const trOf = (e: { translations: unknown }, l: string): Tr => ((e.translations as Record<string, Tr>)[l]) || { question_examples: [], answer_text: '' };

/** The language staff type in for a merchant (its main language). */
export const sourceLang = (M?: MerchantRowAdmin): string => (M?.default_language && (LANGS as readonly string[]).includes(M.default_language) ? M.default_language : 'en');
/** The languages a merchant has switched on, as a list. A merchant that never chose gets Malay and Chinese. */
export const targetLangs = (M?: MerchantRowAdmin): string[] => {
  const src = sourceLang(M);
  const on = String(M?.languages ?? '').split(',').map((x) => x.trim()).filter((x) => (LANGS as readonly string[]).includes(x));
  return (on.length ? on : ['en', 'ms', 'zh']).filter((l) => l !== src);
};
/** Is automatic translation on for this merchant? (On unless an admin switched it off.) */
export const autoOn = (M?: MerchantRowAdmin): boolean => M?.auto_translate === undefined || M?.auto_translate === null ? true : !!Number(M.auto_translate);
export const isUnwritten = (answer: string) => /^\s*TO WRITE:/i.test(answer);

/** The languages of an entry that the AI may fill: no answer yet. With `refresh` (the source text just changed) also the ones the AI wrote and no person changed. Nothing a person wrote is ever listed. */
export const needsTranslation = (e: Entry, src: string, targets: string[], refresh = false): string[] => {
  const s = trOf(e, src).answer_text.trim(); if (!s || isUnwritten(s)) return [];
  return targets.filter((l) => { const t = trOf(e, l); return !t.answer_text.trim() || (refresh && !!t.ai); });
};

/** Asks the AI for the translations of one entry. The languages are asked at the same time, so an entry takes as long as its slowest language. Returns the new texts (marked as AI drafts) and the first error, if any. */
export async function translateEntry(merchant: string, e: Entry, src: string, langs: string[]): Promise<{ made: Record<string, Tr>; error?: string }> {
  const s = trOf(e, src); const made: Record<string, Tr> = {}; let error: string | undefined;
  await Promise.all(langs.map(async (to) => {
    try {
      const r = await api<{ answer: string; examples: string[] }>('/api/admin/translate', { merchant, from: src, to, answer: s.answer_text, examples: s.question_examples });
      const cur = trOf(e, to);
      made[to] = { answer_text: r.answer, question_examples: cur.ai || !cur.question_examples.length ? r.examples : cur.question_examples, ai: true };
    } catch (x) { error = error ?? (x as Error).message; }
  }));
  // keep the order of the languages the caller asked for
  return { made: Object.fromEntries(langs.filter((l) => made[l]).map((l) => [l, made[l]])), error };
}

/** The languages a language filter offers for a merchant: its own languages (main first), and any other language that has words on the page. */
export const langOptions = (M: MerchantRowAdmin | undefined, present: Iterable<string> = []): [string, string][] => {
  const own = [sourceLang(M), ...targetLangs(M)]; const extra = [...new Set(present)].filter((l) => !own.includes(l) && (LANGS as readonly string[]).includes(l));
  return [...own, ...extra].map((l) => [l, LANG_NAMES.find(([k]) => k === l)?.[1] ?? l] as [string, string]);
};
/** The language of a new word: the letters decide (Chinese, Thai, accents); a plain Latin word (depo, wd) gets the merchant's main language when that is also written in plain Latin. */
export const wordLang = (w: string, M?: MerchantRowAdmin): string => { const g = guessLang(w); const src = sourceLang(M); return g === 'en' && ['en', 'ms', 'tl'].includes(src) ? src : g; };
