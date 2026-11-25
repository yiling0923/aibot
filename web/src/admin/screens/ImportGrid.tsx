import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { LANGS, LN, parseTable } from '../model';
import { rowsToCsv } from '../xlsx';
import { useT } from '../i18n';

export interface GridRow { key: string; topic: string; lang: string; q: string; a: string }
const COLS = ['Entry name', 'Topic', 'Language', 'Questions (put | between)', 'Answer'] as const;
const FIELDS = ['key', 'topic', 'lang', 'q', 'a'] as const;
const LANG_NAME: Record<string, string> = { en: 'English', ms: 'Malay', zh: 'Chinese', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino' };
const HEADS = ['intent_key', 'topic', 'language', 'question_examples', 'answer_text'];

const blank = (lang = 'en'): GridRow => ({ key: '', topic: '', lang, q: '', a: '' });
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
/** `defaultLang` is the language of every new row (the merchant's source language) and `langs` the languages the row's list offers (the merchant's languages, from Knowledge base → Languages). */
export default function ImportGrid({ start, onCsv, defaultLang = 'en', langs }: { start: string; onCsv: (csv: string) => void; defaultLang?: string; langs?: string[] }) {
  const { t: T, lang } = useT(); const zh = lang === 'zh';
  const [rows, setRows] = useState<GridRow[]>(() => { const g = csvToGrid(start); return g.length ? [...g, blank(defaultLang), blank(defaultLang)] : Array.from({ length: 8 }, () => blank(defaultLang)); });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {                                                                  // a cell grows with what is typed in it
    box.current?.querySelectorAll<HTMLTextAreaElement>('textarea.gcell').forEach((t) => { t.style.height = 'auto'; t.style.height = Math.max(38, t.scrollHeight) + 'px'; });
  });
  const commit = (n: GridRow[]) => { setRows(n); onCsv(gridToCsv(n)); };
  const clearAll = () => { if (gridToCsv(rows) && !window.confirm(T('Clear the whole table?'))) return; commit(Array.from({ length: 8 }, () => blank(defaultLang))); };
  const set = (y: number, f: keyof GridRow, v: string) => commit(rows.map((r, j) => (j === y ? { ...r, [f]: v } : r)));

  const paste = (e: ClipboardEvent, y: number, x: number) => {
    const text = e.clipboardData.getData('text/plain'); if (!text.includes('\t') && !text.includes('\n')) return;      // one plain word: let the cell take it
    e.preventDefault();
    const used = rows.filter((r) => r.key.trim() || r.topic.trim() || r.q.trim() || r.a.trim());
    const first = text.split(/\r?\n/, 1)[0];
    if (!text.includes('\t') && /intent_key/i.test(first) && first.includes(',')) {                                  // a whole CSV with its header line (the same text as in the Upload a file box): its rows are added under what is already typed
      const g = csvToGrid(text); if (g.length) { commit([...used, ...g, blank(defaultLang), blank(defaultLang)]); return; }
    }
    if (!text.includes('\t') && (x === 3 || x === 4)) {                                                              // text with line breaks pasted into a Questions or Answer cell is ONE cell (an answer with several lines), not one cell for each line
      const f = FIELDS[x]; const v = text.replace(/\r/g, '').trim();
      commit(rows.map((r, j) => (j === y ? { ...r, [f]: f === 'q' ? v.replace(/\n+/g, ' | ') : v } : r))); return;
    }
    let cells: string[][] = text.includes('\t') ? parseTable(text) : text.replace(/\r/g, '').split('\n').filter((l, k, a) => l !== '' || k < a.length - 1).map((l) => [l]);   // one column copied: one cell per line
    if (cells.length && isHeader(cells[0])) { cells = cells.slice(1); x = 0; }
    const n = rows.map((r) => ({ ...r }));
    cells.forEach((line, dy) => {
      while (n.length <= y + dy) n.push(blank(defaultLang));
      line.forEach((v, dx) => { const f = FIELDS[x + dx]; if (!f) return; n[y + dy][f] = f === 'lang' ? toLang(v) : f === 'q' ? v.replace(/\r?\n/g, ' | ').trim() : v.trim(); });
    });
    if (n[n.length - 1] && (n[n.length - 1].key || n[n.length - 1].a)) n.push(blank(defaultLang));
    commit(n);
  };

  return (
    <div className="igrid" ref={box}>
      <div className="sub">{zh ? <>在单元格里输入，或从 Excel 或 Google Sheets 复制单元格后粘贴到这里（点击第一个单元格，然后按 Ctrl+V）。先用主要语言（{T(LANG_NAME[defaultLang] ?? defaultLang)}）写。其他语言会由 AI 补上。如果你自己写了其他语言，条目的每种语言单独一行，使用<b>相同的条目名称</b>。</> : <>Type in the cells, or copy cells from Excel or Google Sheets and paste them here (click the first cell, then press Ctrl+V). Write in the main language ({T(LANG_NAME[defaultLang] ?? defaultLang)}) first. The AI fills the others. If you write another language yourself, give it its own row with the <b>same entry name</b>.</>}</div>
      <div className="tools" style={{ justifyContent: 'flex-end', margin: '6px 0' }}><button className="btn sm" type="button" onClick={clearAll}>{T('Clear table')}</button></div>
      <div className="gridbox"><div className="scroll"><table><thead><tr><th className="rn">#</th>{COLS.map((c) => <th key={c}>{T(c)}</th>)}<th /></tr></thead><tbody>
        {rows.map((r, y) => (
          <tr key={y}><td className="rn">{y + 1}</td>
            <td><input className="gcell" aria-label={T('Entry name, row {n}', { n: y + 1 })} value={r.key} placeholder={y === 0 ? 'deposit_time' : ''} onChange={(e) => set(y, 'key', e.target.value)} onPaste={(e) => paste(e, y, 0)} /></td>
            <td><input className="gcell" aria-label={T('Topic, row {n}', { n: y + 1 })} value={r.topic} placeholder={y === 0 ? 'deposit' : ''} onChange={(e) => set(y, 'topic', e.target.value)} onPaste={(e) => paste(e, y, 1)} /></td>
            <td><select className="gcell lang" aria-label={T('Language, row {n}', { n: y + 1 })} value={r.lang} onChange={(e) => set(y, 'lang', e.target.value)}>{(langs ? [...new Set([...langs, r.lang])] : [...LANGS]).map((l) => <option key={l} value={l}>{T(LANG_NAME[l] ?? LN[l])}</option>)}</select></td>
            <td><textarea className="gcell" rows={1} aria-label={T('Questions, row {n}', { n: y + 1 })} value={r.q} placeholder={y === 0 ? 'how long does deposit take | depo not in yet' : ''} onChange={(e) => set(y, 'q', e.target.value)} onPaste={(e) => paste(e, y, 3)} /></td>
            <td><textarea className="gcell" rows={1} aria-label={T('Answer, row {n}', { n: y + 1 })} value={r.a} placeholder={y === 0 ? 'Deposits are credited within 5 minutes.' : ''} onChange={(e) => set(y, 'a', e.target.value)} onPaste={(e) => paste(e, y, 4)} /></td>
            <td className="del"><button className="btn sm ghost" type="button" aria-label={T('Clear row {n}', { n: y + 1 })} title={T('Clear this row')} onClick={() => commit(rows.length > 1 ? rows.filter((_, j) => j !== y) : [blank(defaultLang)])}>×</button></td></tr>
        ))}</tbody></table></div></div>
      <div className="tools"><button className="btn sm ghost" type="button" onClick={() => setRows([...rows, blank(defaultLang), blank(defaultLang), blank(defaultLang), blank(defaultLang), blank(defaultLang)])}>＋ {T('Add 5 rows')}</button></div>
    </div>
  );
}
