import { useEffect, useRef, useState } from 'react';
import { usePanel } from '../store';
import { LN, type Entry } from '../model';
import { useT } from '../i18n';
import { IconBtn } from '../ui';
import { autoOn, needsTranslation, sourceLang, targetLangs, translateEntry } from '../autotr';

type Tr = { question_examples: string[]; answer_text: string; ai?: boolean };
const trOf = (e: Entry, l: string): Tr => (e.translations as Record<string, Tr>)[l] || { question_examples: [], answer_text: '' };

/** One cell: you type in it as long as you like, and the draft changes when you leave it (Tab, a click elsewhere, or Ctrl+Enter). Escape puts the old text back. */
function Cell({ value, label, row, col, onCommit, invalid, placeholder, ai }: { value: string; label: string; row: number; col: string; onCommit: (v: string) => void; invalid?: boolean; placeholder?: string; ai?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);                         // a change made elsewhere (the full editor, a bulk action) shows here
  const rows = Math.max(2, Math.min(9, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 34)), 0)));
  const cancelled = useRef(false);                                        // Esc leaves the cell without saving what was typed
  const done = () => { if (cancelled.current) { cancelled.current = false; return; } if (text !== value) onCommit(text); };
  return (
    <textarea className={'gcell' + (invalid ? ' bad' : '') + (ai ? ' ai' : '')} aria-label={label} aria-invalid={invalid || undefined} data-r={row} data-c={col} rows={rows} value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)} onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { cancelled.current = true; setText(value); (e.target as HTMLTextAreaElement).blur(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {            // commit and go down to the same column of the next row
          e.preventDefault(); done();
          (document.querySelector(`[data-r="${row + 1}"][data-c="${col}"]`) as HTMLTextAreaElement | null)?.focus();
        }
      }} />
  );
}

/** The Knowledge base as a table you edit in place: the answers in each language and the English example questions, one row per entry. */
export default function KbGrid({ list, onOpen }: { list: Entry[]; onOpen: (e: Entry) => void }) {
  const p = usePanel(); const { t: T, lang } = useT(); const zh = lang === 'zh';
  const src = sourceLang(p.M); const cols = [src, ...targetLangs(p.M)];                       // the languages of this merchant (Knowledge base → Languages), the main language first
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<{ id: number; key: string; langs: string[]; prev: Record<string, Tr | undefined> } | null>(null);        // what the last automatic update replaced, so it can be put back
  const mark = useRef<string>('');                                         // the entry last edited, for the "Saved to the draft" line
  const [saved, setSaved] = useState('');

  const change = (id: number, fn: (e: Entry) => void) => {
    p.edit((d, note) => {
      const e = d.kb.find((x) => x.id === id && x.merchant === p.merchant); if (!e) return;
      fn(e); e.dirty = true; note(`Edited entry "${e.intent_key}" (${p.M.name})`);          // the same line is listed once, however many cells of the entry change
      mark.current = e.intent_key;
    });
    setSaved(mark.current);
  };
  /** After the source text of an entry changed: the AI fills the empty languages and refreshes the ones it wrote before. A text a person wrote is never touched. */
  const autoFill = async (id: number, patch: (e: Entry) => Entry) => {
    if (!autoOn(p.M) || !p.ai.translate) return;
    const cur = p.draft.kb.find((x) => x.id === id && x.merchant === p.merchant); if (!cur) return;
    const e = patch(cur); const langs = needsTranslation(e, src, targetLangs(p.M), true); if (!langs.length) return;
    setBusyIds((s) => new Set(s).add(id));
    const { made, error } = await translateEntry(p.merchant, e, src, langs);
    setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    const ls = Object.keys(made);
    if (ls.length) p.edit((d, note) => {
      const x = d.kb.find((k) => k.id === id && k.merchant === p.merchant); if (!x) return;
      const tr = x.translations as Record<string, Tr>; const put = ls.filter((l) => !(tr[l]?.answer_text ?? '').trim() || tr[l]?.ai);   // a person may have typed there meanwhile
      put.forEach((l) => { tr[l] = made[l]; }); if (!put.length) return; x.dirty = true;
      note(`Translated entry "${x.intent_key}" into ${put.map((l) => LN[l]).join(', ')} with AI (${p.M.name})`);
    });
    if (error) p.toast(error); else if (ls.length) p.toast(T('Translated into {l} (AI draft). Please check it.', { l: ls.map((l) => LN[l]).join(', ') }));
  };
  const setAnswer = (id: number, l: string, v: string) => {
    change(id, (e) => { const t = e.translations as Record<string, Tr>; t[l] = { question_examples: t[l]?.question_examples ?? [], answer_text: v }; });      // a person typed it: no AI mark
    if (l === src && v.trim()) void updateAll(id, v);
  };
  /** The source answer changed: every other language of the merchant is written again from it, so nobody has to edit each language. The old texts are kept for one Undo. */
  const updateAll = async (id: number, v: string) => {
    if (!autoOn(p.M) || !p.ai.translate) return;
    const cur = p.draft.kb.find((x) => x.id === id && x.merchant === p.merchant); if (!cur) return;
    const langs = targetLangs(p.M); if (!langs.length) return;
    const e = { ...cur, translations: { ...cur.translations, [src]: { ...trOf(cur, src), answer_text: v } } as Entry['translations'] };
    const prev: Record<string, Tr | undefined> = Object.fromEntries(langs.map((l) => [l, (cur.translations as Record<string, Tr | undefined>)[l]]));
    setBusyIds((x) => new Set(x).add(id)); setUndo(null);
    const { made, error } = await translateEntry(p.merchant, e, src, langs, { answerOnly: true });
    setBusyIds((x) => { const n = new Set(x); n.delete(id); return n; });
    const ls = Object.keys(made);
    if (ls.length) {
      p.edit((d, note) => { const x = d.kb.find((k) => k.id === id && k.merchant === p.merchant); if (!x) return; const tr = x.translations as Record<string, Tr>; ls.forEach((l) => { tr[l] = made[l]; }); x.dirty = true; note(`Translated entry "${x.intent_key}" into ${ls.map((l) => LN[l]).join(', ')} with AI (${p.M.name})`); });
      if (ls.some((l) => prev[l]?.answer_text?.trim() && !prev[l]?.ai)) setUndo({ id, key: cur.intent_key, langs: ls, prev });      // only offer Undo when a text a person wrote was replaced
    }
    p.toast(error ? error : T('Updated {l} from the new text (AI draft). Please check it.', { l: ls.map((l) => LN[l]).join(', ') }));
  };
  const undoNow = () => {
    if (!undo) return; const u = undo; setUndo(null);
    p.edit((d, note) => { const x = d.kb.find((k) => k.id === u.id && k.merchant === p.merchant); if (!x) return; const tr = x.translations as Record<string, Tr | undefined>; u.langs.forEach((l) => { if (u.prev[l]) tr[l] = u.prev[l]; else delete tr[l]; }); x.dirty = true; note(`Edited entry "${x.intent_key}" (${p.M.name})`); });
    p.toast(T('Put the old texts back.'));
  };
  const setExamples = (id: number, v: string) => {
    const lines = [...new Set(v.split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 40);
    change(id, (e) => { const t = e.translations as Record<string, Tr>; t[src] = { question_examples: lines, answer_text: t[src]?.answer_text ?? '' }; });
    void autoFill(id, (e) => ({ ...e, translations: { ...e.translations, [src]: { ...trOf(e, src), question_examples: lines } } as Entry['translations'] }));
  };
  /** The Live switch applies at once: no Publish button needed. */
  const setLive = async (id: number, live: boolean) => {
    const key = list.find((x) => x.id === id)?.intent_key ?? '';
    change(id, (e) => { e.status = live ? 'live' : 'draft'; });
    try { await p.publishNow(); p.toast(T(live ? 'Live now: “{k}”' : 'Switched off: “{k}”', { k: key })); } catch (e) { p.toast(T('Could not publish: {e}', { e: (e as Error).message })); }
  };
  const unwritten = list.filter((e) => /^\s*TO WRITE:/i.test(trOf(e, 'en').answer_text)).length;

  return (
    <div className="card" aria-label={T('Table editor')}>
      <div className="gtools"><span className="sub">{zh ? <>在单元格里输入，离开它（按 Tab 或点击别处）就会保存到草稿。<b>Ctrl+Enter</b> 保存并下移一行。<b>Esc</b> 恢复原来的文字。完成后按“发布”。</> : <>Type in a cell and leave it (Tab or a click elsewhere) to save it to the draft. <b>Ctrl+Enter</b> saves and goes down one row. <b>Esc</b> puts the old text back. Press Publish when you are done.</>}</span>
        <span className="sub">{T('The columns are the languages of this merchant. Change them in the Languages tab.')}</span></div>
      {unwritten > 0 && <div className="note" style={{ marginTop: 8 }}>{zh ? <><b>{unwritten}</b> 个条目仍写着 <span className="mono">TO WRITE</span>（红色显示）。在写好答案之前，机器人会忽略它们。</> : <><b>{unwritten}</b> {unwritten === 1 ? 'entry still says' : 'entries still say'} <span className="mono">TO WRITE</span> (shown in red). The bot ignores {unwritten === 1 ? 'it' : 'them'} until the answer is written.</>}</div>}
      <div className="scroll gscroll" style={{ marginTop: 10 }}>
        <table className="kbgrid"><thead><tr><th className="gname">{T('Entry')} · {T('Live')}</th>{cols.map((l) => <th key={l}>{T('Answer')} {LN[l]}</th>)}<th>{src === 'en' ? T('Example questions EN') : T('Example questions') + ' ' + LN[src]} <span className="sub">{T('(one per line)')}</span></th></tr></thead>
          <tbody>
            {list.map((e, r) => {
              const en = trOf(e, src).answer_text;
              return (
                <tr key={e.id}>
                  <td className="gname"><div className="gnrow"><button type="button" className="linklike gnname" title={T('Open the full editor')} onClick={() => onOpen(e)}>{e.intent_key}</button><label className="switch"><input type="checkbox" role="switch" aria-label={T('Live {k}', { k: e.intent_key })} checked={e.status === 'live'} onChange={(ev) => setLive(e.id, ev.target.checked)} /><span className="track"><span className="thumb" /></span></label><IconBtn tip={T('Edit {k}', { k: e.intent_key })} onClick={() => onOpen(e)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></IconBtn></div><div className="sub">{busyIds.has(e.id) ? <span className="gbusy"><i aria-hidden="true" />{T('Translating…')}</span> : (e.topic || T('no topic'))}</div></td>
                  {cols.map((l) => <td key={l}><Cell ai={!!trOf(e, l).ai} value={trOf(e, l).answer_text} label={T('Answer {l} for {k}', { l: LN[l], k: e.intent_key })} row={r} col={l} invalid={l === src && (!en.trim() && e.entry_type !== 'needs_staff' || /^\s*TO WRITE:/i.test(en))} placeholder={busyIds.has(e.id) && l !== src ? T('Translating…') : T(l === src ? (e.entry_type === 'needs_staff' ? 'A person answers this' : 'Write the answer') : 'Optional')} onCommit={(v) => setAnswer(e.id, l, v)} />{trOf(e, l).ai && <span className="aibadge">{T('AI draft · check')}</span>}</td>)}
                  <td><Cell value={trOf(e, src).question_examples.join('\n')} label={T('Example questions for {k}', { k: e.intent_key })} row={r} col="ex" invalid={trOf(e, src).question_examples.length < 3} placeholder={T('At least 3, with slang')} onCommit={(v) => setExamples(e.id, v)} /></td>
                </tr>);
            })}
            {!list.length && <tr><td colSpan={cols.length + 2} className="sub">{T('No entries match.')}</td></tr>}
          </tbody></table></div>
      {undo && <div className="note askupd" role="status"><span>{T('The other languages of “{k}” were written again from the new {s} answer (AI draft). Your old texts in {l} were replaced.', { k: undo.key, s: LN[src], l: undo.langs.map((l) => LN[l]).join(', ') })}</span><span className="tools"><button className="btn sm" type="button" onClick={undoNow}>{T('Undo')}</button><button className="btn sm ghost" type="button" onClick={() => setUndo(null)}>{T('Close')}</button></span></div>}
      {saved && <div className="sub" role="status" style={{ marginTop: 8 }}>{T('Saved to the draft: {k}. Press Publish to make the changes live.', { k: saved })}</div>}
    </div>
  );
}
