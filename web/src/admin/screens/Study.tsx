import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';

interface Summary { total: number; learn: number; test: number; lastLoaded: string | null }
interface LoadResult { rows: number; kept: number; dropped: { filler: number; account: number; short: number; duplicate: number }; scrubbed: number; learn: number; test: number; added: number; alreadySaved: number }
interface Gap { question: string; count: number; topic: string | null; lang: string; reply: string; examples: string[] }
interface Measure {
  tested: number; coverage: number | null; accuracy: number | null; scored: number; wrongRate: number | null; judged: number; handoverRate: number | null; clarifyRate: number | null; noAnswerYet: number;
  mistakes: { question: string; staffReply: string; botSaid: string; expected: string }[]; gaps: Gap[];
}

/** The first targets of the plan. They are starting points: set them after the first merchant is measured. */
const TARGETS = { coverage: 0.7, accuracy: 0.85, wrong: 0.03, clarify: 0.15 };
const EXPORT_CMD = 'powershell -ExecutionPolicy Bypass -File deploy\\local-livechat\\export-chats.ps1 -Days 90';
const pct = (v: number | null) => (v === null ? '—' : Math.round(v * 100) + '%');
const cell = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'question';

/** A big number that says whether it reaches the target. */
function Goal({ label, value, ok, target, note }: { label: string; value: string; ok: boolean | null; target: string; note: string }) {
  const color = ok === null ? '#b9c3cf' : ok ? '#7fc4a8' : '#f0c27b';
  return <div className="rptile"><i style={{ background: color }} /><small>{label}</small><b>{value}</b><span>{ok === null ? note : (ok ? 'Reaches the target · ' : 'Below the target · ') + target}</span></div>;
}

export default function Study() {
  const p = usePanel(); const nav = useNavigate(); const base = `/api/admin/merchants/${encodeURIComponent(p.merchant)}/study`;
  const [sum, setSum] = useState<Summary | null>(null); const [text, setText] = useState(''); const [name, setName] = useState(''); const [replace, setReplace] = useState(false);
  const [res, setRes] = useState<LoadResult | null>(null); const [m, setM] = useState<Measure | null>(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const refresh = useCallback(() => api<Summary>(base).then(setSum).catch(() => setSum(null)), [base]);
  useEffect(() => { setM(null); setRes(null); void refresh(); }, [refresh]);

  const load = async () => {
    setBusy('load'); setErr('');
    try { const r = await api<LoadResult>(base + '/import', { text, replace }); setRes(r); setText(''); setName(''); setM(null); await refresh(); p.toast('Saved ' + r.added + ' pairs'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const measure = async () => {
    setBusy('measure'); setErr('');
    try { setM(await api<Measure>(base + '/measure', {})); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const clear = async () => {
    if (!window.confirm('Delete all saved chat pairs of ' + p.M.name + '? The knowledge base is not changed.')) return;
    setBusy('clear'); try { await api(base + '/clear', {}); setM(null); setRes(null); await refresh(); p.toast('Deleted'); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const toImport = () => {
    if (!m?.gaps.length) return;
    const head = 'intent_key,topic,question_type,language,entry_type,question_examples,answer_text,topic_short_forms';
    const rows = m.gaps.map((g, i) => ['study_' + slug(g.question) + '_' + (i + 1), g.topic || 'other', '', g.lang, 'answer', g.examples.join(' | '), g.reply, ''].map(cell).join(','));
    nav('/admin/imp', { state: { csv: [head, ...rows].join('\n') } });
  };
  const copy = () => { void navigator.clipboard?.writeText(EXPORT_CMD).then(() => p.toast('Command copied'), () => p.toast('Select the command and copy it')); };

  return (
    <div className="card"><div className="head"><div><h2>Study real chats · {p.M.name}</h2>
      <div className="sub">Load real customer questions with the staff reply that followed each one. The bot is measured on a part it has never seen, and the questions it cannot answer yet are listed so you can write the missing answers.</div></div>
      {sum && sum.total > 0 && <button className="btn sm" type="button" disabled={!!busy} onClick={() => void clear()}>Delete saved chats</button>}</div>
      <div className="steps" style={{ marginTop: 12 }}>
        <div className="step"><span className="n">1</span><div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}><b>Get the chats</b>
          <div className="sub">Run this on the computer that has LiveChat. It writes <span className="mono">chats_for_study.tsv</span>: each customer message and the first staff reply after it. It only reads the database.</div>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><code className="mono" style={{ background: 'var(--surface2)', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}>{EXPORT_CMD}</code><button className="btn sm" type="button" onClick={copy}>Copy command</button></div>
          <div className="note">Phone numbers, emails, account numbers and member ids are removed when you load the file. <b>Names cannot be found automatically.</b> Keep the file private and delete it when you are done.</div></div></div>
        <div className="step"><span className="n">2</span><div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}><b>Load and clean</b>
          <div className="drop"><div className="tools">
            <input type="file" accept=".tsv,.csv,.txt" aria-label="Choose the chat file" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { setText(String(fr.result)); setName(f.name); setRes(null); }; fr.readAsText(f, 'utf-8'); }} />
            <label className="switch"><input type="checkbox" role="switch" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span className="track"><span className="thumb" /></span> Replace the chats already saved</label>
            <button className="btn pri sm" type="button" disabled={!text.trim() || !!busy} onClick={() => void load()}>{busy === 'load' ? 'Cleaning…' : 'Clean and save'}</button></div>
            <textarea placeholder="Or paste here: two columns, question and reply (CSV or tab separated)" aria-label="Paste the chats" value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setName(''); }} />
            {name && <div className="sub">Chosen: <b>{name}</b></div>}</div>
          {res && <div className="note" aria-label="Result of the cleaning"><b>{res.rows.toLocaleString()}</b> rows read. <b>{res.kept.toLocaleString()}</b> kept ({res.learn.toLocaleString()} to learn from, {res.test.toLocaleString()} held back as the test).
            Dropped: {res.dropped.filler} filler replies (wait, hi, thanks), {res.dropped.account} steps done for one member, {res.dropped.short} questions too short or only a file, {res.dropped.duplicate} duplicates.
            Personal details removed: {res.scrubbed}.{res.alreadySaved ? ` ${res.alreadySaved} were already saved.` : ''}</div>}
          {sum && <div className="stats"><div className="stat"><b>{sum.total.toLocaleString()}</b>pairs saved</div><div className="stat"><b>{sum.learn.toLocaleString()}</b>to learn from</div><div className="stat"><b>{sum.test.toLocaleString()}</b>held back as the test</div></div>}</div></div>
        <div className="step"><span className="n">3</span><div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}><b>Measure the bot</b>
          <div className="sub">Runs the <b>published</b> bot (its rules, without AI) on the held-back questions and compares it with what staff really sent.</div>
          <div><button className="btn pri sm" type="button" disabled={!sum || sum.test === 0 || !!busy} onClick={() => void measure()}>{busy === 'measure' ? 'Measuring…' : 'Measure the bot'}</button>{sum && sum.total > 0 && sum.test === 0 && <span className="sub"> The test part is empty: load more chats.</span>}</div>
          {m && <>
            <div className="btiles" aria-label="Measured results">
              <Goal label="Coverage" value={pct(m.coverage)} ok={m.coverage === null ? null : m.coverage >= TARGETS.coverage} target="at least 70%" note="no test questions" />
              <Goal label="Accuracy" value={pct(m.accuracy)} ok={m.accuracy === null ? null : m.accuracy >= TARGETS.accuracy} target="at least 85%" note="no staff reply matched an answer yet" />
              <Goal label="Wrong-answer rate" value={pct(m.wrongRate)} ok={m.wrongRate === null ? null : m.wrongRate <= TARGETS.wrong} target="at most 3%" note="no answer could be checked" />
              <Goal label="Clarify rate" value={pct(m.clarifyRate)} ok={m.clarifyRate === null ? null : m.clarifyRate <= TARGETS.clarify} target="at most 15%" note="no test questions" />
              <Goal label="Handover rate" value={pct(m.handoverRate)} ok={null} target="" note="tracked only; falls as answers grow" />
            </div>
            <div className="sub"><b>Coverage</b>: questions the bot answered by itself. <b>Accuracy</b>: of the {m.scored.toLocaleString()} questions where staff sent one of this merchant's own answers, how often the bot picked that same answer. <b>Wrong-answer rate</b>: answers that were not the one staff sent (worse than a handover). The targets are starting points from the plan: set them after you measure the first merchant. {m.tested.toLocaleString()} questions tested; {m.noAnswerYet.toLocaleString()} had a staff reply that matches none of the answers yet.</div>
            {m.mistakes.length > 0 && <details className="fold"><summary>Wrong answers ({m.mistakes.length}{m.judged > m.mistakes.length ? ' of ' + Math.round((m.wrongRate ?? 0) * m.judged) : ''})</summary>
              <div className="scroll"><table><thead><tr><th>Customer asked</th><th>The bot said</th><th>Staff sent</th></tr></thead><tbody>{m.mistakes.map((x, i) => <tr key={i}><td>{x.question}</td><td>{x.botSaid}</td><td>{x.staffReply}</td></tr>)}</tbody></table></div></details>}</>}</div></div>
        {m && <div className="step"><span className="n">4</span><div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}><b>Answers that are missing</b>
          {m.gaps.length === 0 ? <div className="sub">Every question in the learn part is already handled. Nothing is missing.</div> : <>
            <div className="sub">One row is one answer staff sent, with the questions customers asked before it. They are the questions the bot cannot answer yet, most asked first. They come only from the learn part, so the test stays honest. Check each answer, then send them to Import: they come in as drafts.</div>
            <div className="scroll"><table><thead><tr><th>Asked</th><th>Customers asked, for example</th><th>Topic</th><th>Staff replied</th></tr></thead><tbody>{m.gaps.map((g, i) => <tr key={i}><td>{g.count}×</td><td>{g.examples.slice(0, 3).join(' · ')}</td><td>{g.topic || <span className="sub">none</span>}</td><td>{g.reply}</td></tr>)}</tbody></table></div>
            <div><button className="btn pri sm" type="button" onClick={toImport}>Send {m.gaps.length} suggestions to Import</button></div></>}</div></div>}
      </div>
      {err && <div className="note" style={{ background: 'var(--badbg)', marginTop: 10 }}>{err}</div>}
    </div>
  );
}
