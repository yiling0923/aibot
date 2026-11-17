import type { KbEntry } from './types';

/** The marker the FAQ category starter puts in every answer that is not written yet. */
export const isPlaceholder = (t: string | undefined) => /^\s*TO WRITE:/i.test(t ?? '');

/**
 * An answer that still says "TO WRITE:" must never reach a customer, even if someone set the entry live.
 * Such answers are left out; an entry left with no answer at all is left out too, unless a person answers it (needs staff: the bot says nothing of its own).
 */
export function withoutPlaceholders(e: KbEntry): KbEntry | null {
  if (e.entryType === 'needs_staff') return e;
  const translations = Object.fromEntries(Object.entries(e.translations).filter(([, t]) => !isPlaceholder(t?.answerText))) as KbEntry['translations'];
  return Object.values(translations).some((t) => (t?.answerText ?? '').trim()) ? { ...e, translations } : null;
}
