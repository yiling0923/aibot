import { useRef, useState, type ClipboardEvent } from 'react';
import { LANGS, LN, parseTable } from '../model';
import { rowsToCsv } from '../xlsx';

export interface GridRow { key: string; topic: string; lang: string; q: string; a: string }
const COLS = ['Entry name', 'Topic', 'Language', 'Questions customers ask (put | between them)', 'Answer'] as const;
const FIELDS = ['key', 'topic', 'lang', 'q', 'a'] as const;
const LANG_NAME: Record<string, string> = { en: 'English', ms: 'Malay', zh: 'Chinese', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino' };
const HEADS = ['intent_key', 'topic', 'language', 'question_examples', 'answer_text'];

const blank = (): GridRow => ({ key: '', topic: '', lang: 'en', q: '', a: '' });
const isHeader = (r: string[]) => /^(intent_key|entry|entry name|entry_name|name)$/i.test((r[0] || '').trim());
const toLang = (v: string) => { const x = v.trim().toLowerCase(); return (LANGS as readonly string[]).includes(x) ? x : Object.entries(LANG_NAME).find(([, n]) => n.toLowerCase() === x)?.[0] ?? (x || 'en'); };

/** The table as CSV text, which the check below it reads. Rows with nothing typed are left out. */
export function gridToCsv(rows: GridRow[]): string {
  const used = rows.filter((r) => r.key.trim() || r.topic.trim() || r.q.trim() || r.a.trim());
  return used.length ? rowsToCsv([HEADS, ...used.map((r) => [r.key.trim(), r.topic.trim(), r.lang, r.q.split(/\n/).map((x) => x.trim()).filter(Boolean).join(' | '), r.a.trim()])]) : '';
}
/** CSV text (from a file, a starter pack or an earlier visit) as table rows. Columns are found by their names. */
export function csvToGrid(text: string): GridRow[] {
  const t = parseTable(text); if (t.length < 2) return [];
  const head = t[0].map((h) => h.trim().toLowerCase()); const at = (names: string[]) => head.findIndex((h) => names.includes(h));
  const i = { key: at(['intent_key', 'entry', 'entry_name', 'name']), topic: at(['topic', 'topic_word']), lang: at(['language', 'lang']), q: at(['question_examples', 'examples', 'questions']), a: at(['answer_text', 'answer']) };
  return t.slice(1).map((r) => ({ key: (r[i.key] ?? '').trim(), topic: (r[i.topic] ?? '').trim(), lang: toLang(r[i.lang] ?? 'en'), q: (r[i.q] ?? '').trim(), a: (r[i.a] ?? '').trim() }));
}

/** An Excel-like table: type in the cells, or paste cells copied from Excel or Google Sheets. */
export default function ImportGrid({ start, onCsv }: { start: string; onCsv: (csv: string) => void }) {
  const [rows, setRows] = useState<GridRow[]>(() => { const g = csvToGrid(start); return g.length ? [...g, blank(), blank()] : Array.from({ length: 8 }, blank); });
  const box = useRef<HTMLDivElement>(null);
  const commit = (n: GridRow[]) => { setRows(n); onCsv(gridToCsv(n)); };
  const set = (y: number, f: keyof GridRow, v: string) => commit(rows.map((r, j) => (j === y ? { ...r, [f]: v } : r)));

  const paste = (e: ClipboardEvent, y: number, x: number) => {
    const text = e.clipboardData.getData('text/plain'); if (!text.includes('\t') && !text.includes('\n')) return;      // one plain word: let the cell take it
    e.preventDefault();
    let cells: string[][] = text.includes('\t') ? parseTable(text) : text.replace(/\r/g, '').split('\n').filter((l, k, a) => l !== '' || k < a.length - 1).map((l) => [l]);   // one column copied: one cell per line
    if (cells.length && isHeader(cells[0])) { cells = cells.slice(1); x = 0; }
    const n = rows.map((r) => ({ ...r }));
    cells.forEach((line, dy) => {
      while (n.length <= y + dy) n.push(blank());
      line.forEach((v, dx) => { const f = FIELDS[x + dx]; if (!f) return; n[y + dy][f] = f === 'lang' ? toLang(v) : f === 'q' ? v.replace(/\r?\n/g, ' | ').trim() : v.trim(); });
    });
    if (n[n.length - 1] && (n[n.length - 1].key || n[n.length - 1].a)) n.push(blank());
    commit(n);
  };

  return (
    <div className="igrid" ref={box}>
      <div className="sub">Type in the cells, or copy cells from Excel or Google Sheets and paste them here (click the first cell, then press Ctrl+V). Write English first. Each language of an entry is its own row with the <b>same entry name</b>.</div>
      <div className="scroll"><table><thead><tr><th className="rn">#</th>{COLS.map((c) => <th key={c}>{c}</th>)}<th /></tr></thead><tbody>
        {rows.map((r, y) => (
          <tr key={y}><td className="rn">{y + 1}</td>
            <td><input aria-label={`Entry name, row ${y + 1}`} value={r.key} placeholder={y === 0 ? 'deposit_time' : ''} onChange={(e) => set(y, 'key', e.target.value)} onPaste={(e) => paste(e, y, 0)} /></td>
            <td><input aria-label={`Topic, row ${y + 1}`} value={r.topic} placeholder={y === 0 ? 'deposit' : ''} onChange={(e) => set(y, 'topic', e.target.value)} onPaste={(e) => paste(e, y, 1)} /></td>
            <td><select aria-label={`Language, row ${y + 1}`} value={r.lang} onChange={(e) => set(y, 'lang', e.target.value)}>{LANGS.map((l) => <option key={l} value={l}>{LANG_NAME[l] ?? LN[l]}</option>)}</select></td>
            <td><textarea rows={2} aria-label={`Questions, row ${y + 1}`} value={r.q} placeholder={y === 0 ? 'how long does deposit take | depo not in yet' : ''} onChange={(e) => set(y, 'q', e.target.value)} onPaste={(e) => paste(e, y, 3)} /></td>
            <td><textarea rows={2} aria-label={`Answer, row ${y + 1}`} value={r.a} placeholder={y === 0 ? 'Deposits are credited within 5 minutes.' : ''} onChange={(e) => set(y, 'a', e.target.value)} onPaste={(e) => paste(e, y, 4)} /></td>
            <td><button className="btn sm ghost" type="button" aria-label={`Clear row ${y + 1}`} title="Clear this row" onClick={() => commit(rows.length > 1 ? rows.filter((_, j) => j !== y) : [blank()])}>×</button></td></tr>
        ))}</tbody></table></div>
      <div className="tools"><button className="btn sm" type="button" onClick={() => setRows([...rows, blank(), blank(), blank(), blank(), blank()])}>Add 5 rows</button>
        <button className="btn sm" type="button" onClick={() => commit(Array.from({ length: 8 }, blank))}>Clear table</button></div>
    </div>
  );
}
