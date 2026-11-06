import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { LANGS, LN, type UnmatchedRow } from '../model';
import { Modal, Pill } from '../ui';

/** Messages customers wrote that the bot could not answer. The point of this screen: turn each one into an answer, so the same question works next time. */
export default function Unmatched() {
  const p = usePanel(); const nav = useNavigate();
  const [tab, setTab] = useState<'open' | 'done'>('open'); const [q, setQ] = useState('');
  const [adding, setAdding] = useState<UnmatchedRow | null>(null);
  const open = p.unmatched.filter((r) => !r.resolved), done = p.unmatched.filter((r) => r.resolved);
  const Q = q.trim().toLowerCase();
  const list = (tab === 'open' ? open : done).filter((r) => !Q || r.text.toLowerCase().includes(Q));
  const langOf = (r: UnmatchedRow) => ((LANGS as readonly string[]).includes(r.language ?? '') ? (r.language as string) : 'en');
  const act = async (fn: () => Promise<void>, ok?: string) => { try { await fn(); if (ok) p.toast(ok); } catch (e) { p.toast('Could not save that: ' + (e as Error).message); } };

  return (
    <>
      <div className="card"><div className="head"><div><h2>Not understood · {p.M.name}</h2><div className="sub">Messages the bot could not answer, most frequent first. Add each one to an answer, or make a new answer for it. Then the bot understands it next time.</div></div></div>
        <div className="quiet"><b>{open.length}</b> to look at{done.length ? <> · <b>{done.length}</b> dealt with</> : null}</div></div>
      <div className="card rkfilter"><div className="head"><div className="segs" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>To look at <span className="n">{open.length}</span></button>
        <button type="button" aria-pressed={tab === 'done'} onClick={() => setTab('done')}>Dealt with <span className="n">{done.length}</span></button></div>
        <div className="filt"><input type="search" placeholder="Filter messages" aria-label="Filter messages" value={q} onChange={(e) => setQ(e.target.value)} /><span className="sub">{list.length} shown</span></div></div></div>
      <div className="card scroll"><table style={{ minWidth: 820 }}><thead><tr><th>Message</th><th>Language</th><th className="num">Times</th><th>Last seen</th><th></th></tr></thead><tbody>
        {list.map((r) => (
          <tr key={r.text} className={tab === 'open' ? 'todo' : ''}>
            <td><b>{r.text}</b></td>
            <td>{r.language ? <Pill>{LN[r.language] ?? r.language}</Pill> : null}</td>
            <td className="num">{r.hits}</td>
            <td className="sub">{r.last}{r.resolved ? ' · ' + (r.resolution === 'added' ? 'added to an answer' : 'ignored') : ''}</td>
            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
              {tab === 'open' ? <>
                <button className="btn sm pri" type="button" onClick={() => setAdding(r)}>Add to an answer</button>{' '}
                <button className="btn sm" type="button" onClick={() => nav('/admin/kb', { state: { prefill: { lang: langOf(r), text: r.text } } })}>New answer</button>{' '}
                <button className="btn sm ghost" type="button" onClick={() => act(() => p.resolveUnmatched([r.text], 'ignored'), 'Ignored')}>Ignore</button></>
                : <button className="btn sm" type="button" onClick={() => act(() => p.resolveUnmatched([r.text], null))}>Open again</button>}
            </td>
          </tr>))}
        {!list.length && <tr><td colSpan={5} className="sub">{tab === 'open' ? (p.unmatched.length ? 'Nothing left to look at.' : 'Nothing yet. When a customer writes something the bot does not understand, it appears here.') : 'Nothing dealt with yet.'}</td></tr>}
      </tbody></table></div>
      {adding && <AddExample row={adding} lang={langOf(adding)} onClose={() => setAdding(null)} onDone={async (entryName, lang) => { await act(() => p.resolveUnmatched([adding.text], 'added')); setAdding(null); p.toast(`Added to "${entryName}" (${LN[lang]}). Publish to make it live.`); }} />}
    </>
  );
}

/** Adds the message as an example question of an existing answer (as a draft change). */
function AddExample({ row, lang: first, onClose, onDone }: { row: UnmatchedRow; lang: string; onClose: () => void; onDone: (entry: string, lang: string) => Promise<void> }) {
  const p = usePanel();
  const entries = p.draft.kb.filter((e) => e.merchant === p.merchant).sort((a, b) => a.intent_key.localeCompare(b.intent_key));
  const [id, setId] = useState<number>(entries[0]?.id ?? 0); const [lang, setLang] = useState(first); const [q, setQ] = useState('');
  const shown = entries.filter((e) => !q || (e.intent_key + ' ' + e.topic).toLowerCase().includes(q.toLowerCase()));
  const chosen = entries.find((e) => e.id === id);
  const save = async () => {
    if (!chosen) return p.toast('Choose an answer first.');
    const text = row.text.trim();
    const exists = (chosen.translations[lang as 'en']?.question_examples ?? []).some((x) => x.toLowerCase() === text.toLowerCase());
    if (!exists) p.edit((d, note) => {
      const e = d.kb.find((x) => x.id === id)!; const tr = (e.translations as Record<string, { question_examples: string[]; answer_text: string }>);
      tr[lang] = tr[lang] ?? { question_examples: [], answer_text: '' }; tr[lang].question_examples.push(text); e.dirty = true;
      note(`Added the example "${text}" to the entry "${e.intent_key}" (${p.M.name})`);
    });
    await onDone(chosen.intent_key, lang);
  };
  return (
    <Modal small label="Add to an answer" onClose={onClose}>
      <h2>Add to an answer</h2><div className="sub">“{row.text}” becomes an example question of the answer you choose.</div>
      <div className="form">
        <label className="fld full"><span>Find an answer</span><input type="text" placeholder="Type to filter, for example deposit" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="fld full"><span>Answer</span><select value={shown.some((e) => e.id === id) ? id : shown[0]?.id ?? 0} onChange={(e) => setId(+e.target.value)}>
          {shown.map((e) => <option key={e.id} value={e.id}>{e.intent_key} ({e.topic || 'no topic'}){e.status === 'draft' ? ' · draft' : ''}</option>)}</select></label>
        <label className="fld"><span>Language of the example</span><select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l} value={l}>{LN[l]}</option>)}</select></label>
      </div>
      {chosen && !(chosen.translations[lang as 'en']?.answer_text ?? '').trim() && <div className="note" style={{ background: 'var(--warnbg)' }}>This answer has no {LN[lang]} text yet. The example is saved, but add the {LN[lang]} answer too.</div>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn pri" type="button" disabled={!entries.length} onClick={save}>Add to draft</button></div>
    </Modal>
  );
}
