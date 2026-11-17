import { useEffect, useRef, useState } from 'react';
import { usePanel } from '../store';
import { LANGS, LN, type Entry } from '../model';

type Tr = { question_examples: string[]; answer_text: string };
const trOf = (e: Entry, l: string): Tr => (e.translations as Record<string, Tr>)[l] || { question_examples: [], answer_text: '' };
/** The languages that can be shown as columns. English is always there; Malay and Chinese start on. */
const COLS = LANGS.filter((l) => l !== 'en');

/** One cell: you type in it as long as you like, and the draft changes when you leave it (Tab, a click elsewhere, or Ctrl+Enter). Escape puts the old text back. */
function Cell({ value, label, row, col, onCommit, invalid, placeholder }: { value: string; label: string; row: number; col: string; onCommit: (v: string) => void; invalid?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);                         // a change made elsewhere (the full editor, a bulk action) shows here
  const rows = Math.max(2, Math.min(9, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 34)), 0)));
  const cancelled = useRef(false);                                        // Esc leaves the cell without saving what was typed
  const done = () => { if (cancelled.current) { cancelled.current = false; return; } if (text !== value) onCommit(text); };
  return (
    <textarea className={'gcell' + (invalid ? ' bad' : '')} aria-label={label} aria-invalid={invalid || undefined} data-r={row} data-c={col} rows={rows} value={text} placeholder={placeholder}
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
  const p = usePanel();
  const [shown, setShown] = useState<Set<string>>(() => new Set(['ms', 'zh']));
  const cols = ['en', ...COLS.filter((l) => shown.has(l))];
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
  const setAnswer = (id: number, l: string, v: string) => change(id, (e) => { const t = e.translations as Record<string, Tr>; t[l] = { question_examples: t[l]?.question_examples ?? [], answer_text: v }; });
  const setExamples = (id: number, v: string) => change(id, (e) => { const t = e.translations as Record<string, Tr>; const lines = [...new Set(v.split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 40); t.en = { question_examples: lines, answer_text: t.en?.answer_text ?? '' }; });
  const setLive = (id: number, live: boolean) => change(id, (e) => { e.status = live ? 'live' : 'draft'; });
  const unwritten = list.filter((e) => /^\s*TO WRITE:/i.test(trOf(e, 'en').answer_text)).length;

  return (
    <div className="card" aria-label="Table editor">
      <div className="gtools"><span className="sub">Type in a cell and leave it (Tab or a click elsewhere) to save it to the draft. <b>Ctrl+Enter</b> saves and goes down one row. <b>Esc</b> puts the old text back. Press Publish when you are done.</span>
        <span className="gcols" role="group" aria-label="Languages shown">{COLS.map((l) => <button key={l} type="button" className="btn sm" aria-pressed={shown.has(l)} onClick={() => setShown((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; })}>{LN[l]}</button>)}</span></div>
      {unwritten > 0 && <div className="note" style={{ marginTop: 8 }}><b>{unwritten}</b> {unwritten === 1 ? 'entry still says' : 'entries still say'} <span className="mono">TO WRITE</span> (shown in red). The bot ignores {unwritten === 1 ? 'it' : 'them'} until the answer is written.</div>}
      <div className="scroll" style={{ marginTop: 10 }}>
        <table className="kbgrid"><thead><tr><th className="gname">Entry</th><th className="glive">Live</th>{cols.map((l) => <th key={l}>Answer {LN[l]}</th>)}<th>Example questions EN <span className="sub">(one per line)</span></th></tr></thead>
          <tbody>
            {list.map((e, r) => {
              const en = trOf(e, 'en').answer_text;
              return (
                <tr key={e.id}>
                  <td className="gname"><button type="button" className="linklike" title="Open the full editor" onClick={() => onOpen(e)}>{e.intent_key}</button><div className="sub">{e.topic || 'no topic'}</div></td>
                  <td className="glive"><input type="checkbox" aria-label={'Live ' + e.intent_key} checked={e.status === 'live'} onChange={(ev) => setLive(e.id, ev.target.checked)} /></td>
                  {cols.map((l) => <td key={l}><Cell value={trOf(e, l).answer_text} label={`Answer ${LN[l]} for ${e.intent_key}`} row={r} col={l} invalid={l === 'en' && (!en.trim() && e.entry_type !== 'needs_staff' || /^\s*TO WRITE:/i.test(en))} placeholder={l === 'en' ? (e.entry_type === 'needs_staff' ? 'A person answers this' : 'Write the answer') : 'Optional'} onCommit={(v) => setAnswer(e.id, l, v)} /></td>)}
                  <td><Cell value={trOf(e, 'en').question_examples.join('\n')} label={`Example questions for ${e.intent_key}`} row={r} col="ex" invalid={trOf(e, 'en').question_examples.length < 3} placeholder="At least 3, with slang" onCommit={(v) => setExamples(e.id, v)} /></td>
                </tr>);
            })}
            {!list.length && <tr><td colSpan={cols.length + 3} className="sub">No entries match.</td></tr>}
          </tbody></table></div>
      {saved && <div className="sub" role="status" style={{ marginTop: 8 }}>Saved to the draft: {saved}. Press Publish to make the changes live.</div>}
    </div>
  );
}
