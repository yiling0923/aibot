import { useMemo, useRef, useState } from 'react';
import { usePanel } from '../store';
import { LN, LANG_NAMES, type Entry } from '../model';
import { needsTranslation, sourceLang, targetLangs, translateEntry } from '../autotr';
import { Modal } from '../ui';
import { useT } from '../i18n';

const NAME: Record<string, string> = Object.fromEntries(LANG_NAMES);

/** What "Translate all" would do for the open merchant: the entries that have a source answer and at least one language the AI may fill. */
export function useTranslateJobs() {
  const p = usePanel(); const src = sourceLang(p.M); const targets = targetLangs(p.M);
  return useMemo(() => {
    const jobs = p.draft.kb.filter((e) => e.merchant === p.merchant).map((e) => ({ e, langs: needsTranslation(e, src, targets) })).filter((j) => j.langs.length);
    return { jobs, src, targets, count: jobs.length, total: jobs.reduce((n, j) => n + j.langs.length, 0) };
  }, [p.draft, p.merchant, p.M]);
}

/** The window of the "Translate all" button: it says how much will be translated, then does it one entry at a time, and fills only the empty languages. */
export default function TranslateAll({ onClose }: { onClose: () => void }) {
  const p = usePanel(); const { t } = useT(); const { jobs, src, targets, count, total } = useTranslateJobs();
  const [run, setRun] = useState<{ n: number; done: number; error?: string } | null>(null); const stop = useRef(false);
  const names = targets.filter((l) => jobs.some((j) => j.langs.includes(l))).map((l) => t(NAME[l] ?? l)).join(', ');

  const go = async () => {
    stop.current = false; setRun({ n: jobs.length, done: 0 });
    let done = 0, error: string | undefined;
    for (const j of jobs) {
      if (stop.current) break;
      const { made, error: er } = await translateEntry(p.merchant, j.e, src, j.langs);
      const ls = Object.keys(made);
      if (ls.length) p.edit((d, note) => {
        const e = d.kb.find((x) => x.id === j.e.id && x.merchant === p.merchant); if (!e) return;
        const tr = e.translations as Record<string, unknown>; ls.forEach((l) => { tr[l] = made[l]; }); e.dirty = true;
        note(`Translated entry "${e.intent_key}" into ${ls.map((l) => LN[l]).join(', ')} with AI (${p.M.name})`);
      });
      done++; setRun({ n: jobs.length, done, error: er ?? error }); if (er) { error = er; if (!ls.length && /not set up/i.test(er)) break; }
    }
    setRun({ n: jobs.length, done, error });
    p.toast(error ? error : t('Translated {n} entries. They are AI drafts: please check them, then publish.', { n: done }));
  };

  return (
    <Modal small label="Translate all" onClose={() => { stop.current = true; onClose(); }}>
      <h2>{t('Translate all')}</h2>
      {!run && !count ? <div className="note" style={{ marginTop: 10 }}>{t('Nothing to translate: every language this merchant uses already has an answer.')}</div> : !run ? <>
        <p>{t('Translate {n} entries into {l}? About {m} translations.', { n: count, l: names, m: total })}</p>
        <div className="sub">{t('Only empty languages are filled. A text a person wrote is never changed. The new texts are marked “AI draft”, and the entries stay as they are (live or draft) until you publish.')}</div>
        {!p.ai.translate && <div className="note" style={{ marginTop: 10, background: 'var(--warnbg)' }}>{t('The AI is off. Add the Anthropic key to .env.')}</div>}</> : <>
        <p role="status">{run.done < run.n && !run.error ? t('Translating {a} of {b}…', { a: run.done + 1, b: run.n }) : t('Done: {a} of {b} entries.', { a: run.done, b: run.n })}</p>
        <div className="cbar" role="progressbar" aria-valuenow={run.done} aria-valuemin={0} aria-valuemax={run.n}><i style={{ width: Math.round((run.done * 100) / run.n) + '%' }} /></div>
        {run.error && <div className="note" style={{ marginTop: 10, background: 'var(--warnbg)' }}>{run.error}</div>}</>}
      <div className="head" style={{ marginTop: 14 }}><button className="btn" type="button" onClick={() => { stop.current = true; onClose(); }}>{t(run && run.done >= run.n ? 'Close' : 'Cancel')}</button>
        {count > 0 && !run && <button className="btn pri" type="button" disabled={!p.ai.translate} onClick={() => void go()}>{t('Translate')}</button>}</div>
    </Modal>
  );
}
