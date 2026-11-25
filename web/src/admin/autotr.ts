import { api } from '../lib/api';
import { LANGS, type Entry, type MerchantRowAdmin } from './model';

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

/** Asks the AI for the translations of one entry. Returns the new texts (marked as AI drafts) and the first error, if any. */
export async function translateEntry(merchant: string, e: Entry, src: string, langs: string[]): Promise<{ made: Record<string, Tr>; error?: string }> {
  const s = trOf(e, src); const made: Record<string, Tr> = {}; let error: string | undefined;
  for (const to of langs) {
    try {
      const r = await api<{ answer: string; examples: string[] }>('/api/admin/translate', { merchant, from: src, to, answer: s.answer_text, examples: s.question_examples });
      const cur = trOf(e, to);
      made[to] = { answer_text: r.answer, question_examples: cur.ai || !cur.question_examples.length ? r.examples : cur.question_examples, ai: true };
    } catch (x) { error = error ?? (x as Error).message; if (/AI is not set up/i.test((x as Error).message)) break; }
  }
  return { made, error };
}
