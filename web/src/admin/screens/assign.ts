import { usePanel } from '../store';
import { guessLang } from '../model';

/** Puts many keywords into a list at once (rank and keyword screens). Returns what was done, or an error text. */
export function useAssign() {
  const p = usePanel();
  return (words: string[], kind: string, topic?: string): { done: string[]; skipped: string[]; err?: string } => {
    if (kind === 'exclude') { words.forEach((w) => p.ignoreWord(w)); return { done: words, skipped: [] }; }
    if (!p.isAdmin && kind !== 'topic') return { done: [], skipped: [], err: 'Only admins can change these lists' };
    const done: string[] = [], skipped: string[] = [];
    p.edit((d, note) => {
      words.forEach((w) => {
        if (p.status(w).t !== 'Not set yet') { skipped.push(w); return; }
        const lg = p.kwMap[w]?.lg || guessLang(w); const lw = w.toLowerCase();
        if (kind === 'filler') (d.fillers[lg] = d.fillers[lg] || []).push(lw);
        if (kind === 'rude') (d.guard.abuse[lg] = d.guard.abuse[lg] || []).push(lw);
        if (kind === 'mild') (d.guard.abuse_soft[lg] = d.guard.abuse_soft[lg] || []).push(lw);
        if (kind === 'topic' && topic) (d.mAliases[p.merchant] = d.mAliases[p.merchant] || []).push({ language: lg, variant: lw, canonical: topic });      // a keyword belongs to this merchant
        done.push(w);
      });
      if (done.length) note(({ filler: 'Marked as filler words: ', rude: 'Added rude words: ', mild: 'Added mild rude words: ', topic: 'Added keywords to topic "' + topic + '": ' } as Record<string, string>)[kind] + done.join(', '));
    });
    return { done, skipped };
  };
}
