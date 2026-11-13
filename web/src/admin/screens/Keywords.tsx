import { useState } from 'react';
import { api } from '../../lib/api';
import { LANG_NAMES, topicNames } from '../model';
import { usePanel } from '../store';
import { Pill } from '../ui';
import { KeywordDrawer, SetKeywordModal } from './KeywordModals';
import { useAssign } from './assign';

const TABS: [string, string][] = [['all', 'All'], ['unassigned', 'Not assigned'], ['assigned', 'Assigned'], ['ignored', 'Ignored']];

export default function Keywords() {
  const p = usePanel(); const assign = useAssign(); const lock = !p.isAdmin;
  const [tab, setTab] = useState('all'); const [q, setQ] = useState(''); const [lang, setLang] = useState('all'); const [sel, setSel] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false);
  const [setFor, setSetFor] = useState<{ w: string; preset?: string } | null>(null); const [drawer, setDrawer] = useState<string | null>(null);

  const all = p.kw.map((k) => ({ ...k, st: p.status(k.w), ignored: p.ignored.has(k.w) }));
  const inTab = (r: (typeof all)[number], t: string) => t === 'all' || (t === 'ignored' ? r.ignored : t === 'unassigned' ? !r.ignored && r.st.t === 'Not set yet' : !r.ignored && r.st.t !== 'Not set yet');
  const counts = Object.fromEntries(TABS.map(([k]) => [k, all.filter((r) => inTab(r, k)).length]));
  const Q = q.trim().toLowerCase();
  const list = all.filter((r) => inTab(r, tab) && (!Q || r.w.toLowerCase().includes(Q) || r.h.toLowerCase().includes(Q)) && (lang === 'all' || r.lg === lang))
    .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0) || b.n - a.n || a.w.localeCompare(b.w));
  const allSel = list.length > 0 && list.every((r) => sel.has(r.w));
  const topics = topicNames(p.draft, p.merchant); const topicNow = topics.includes(topic) ? topic : topics[0];
  const toggle = (w: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(w); else n.delete(w); return n; });

  const bulk = (k: string) => {
    const words = [...sel]; if (!words.length) return;
    const res = assign(words, k, topicNow); if (res.err) return p.toast(res.err);
    setSel(new Set());
    p.toast(k === 'exclude' ? words.length + ' keywords ignored' : res.done.length + ' keyword' + (res.done.length === 1 ? '' : 's') + (k === 'topic' ? ' added to the topic "' + topicNow + '"' : ' added to the draft') + (res.skipped.length ? ' (' + res.skipped.length + ' already assigned)' : ''));
  };
  const describe = async () => {
    setBusy(true);
    try { const r = await api<{ tried: number; done: number }>('/api/admin/keywords/describe', { merchant: p.merchant }); await p.reloadKeywords(); p.toast(r.tried ? 'Described ' + r.done + ' of ' + r.tried + ' words' : 'Every word already has a description'); }
    catch (e) { p.toast((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="card"><div className="head"><div><h2>Keywords</h2><div className="sub">Every word customers type is saved here automatically. Make a keyword a topic, or add it to a topic.</div></div>
        {p.ai.describe ? <button className="btn" type="button" disabled={busy} onClick={describe} title="Claude writes a short note and suggests a type for words that have none">{busy ? 'Asking Claude…' : 'Describe new words with AI'}</button> : null}</div>
        <div className="quiet"><b>{all.length}</b> keywords saved · <b>{counts.unassigned}</b> not assigned yet · newest first{p.ai.describe ? '' : <> · <span title="Add the Anthropic key to .env">AI descriptions are off</span></>}</div></div>
      <div className="card rkfilter"><div className="head"><div className="segs" role="group" aria-label="Show">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setSel(new Set()); }}>{l} <span className="n">{counts[k]}</span></button>)}</div>
        <div className="filt"><input type="search" placeholder="Filter keywords" aria-label="Filter keywords" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{LANG_NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <span className="sub">{list.length} keywords shown</span></div></div></div>
      <div className="card scroll">
        {sel.size > 0 && <div className="bulk"><b>{sel.size} selected</b><span className="tools"><select aria-label="Topic" value={topicNow} onChange={(e) => setTopic(e.target.value)}>{topics.map((k) => <option key={k}>{k}</option>)}</select>
          <button className="btn sm pri" type="button" onClick={() => bulk('topic')}>Add to this topic</button><button className="btn sm" type="button" disabled={lock} onClick={() => bulk('filler')}>Mark as filler</button><button className="btn sm" type="button" disabled={lock} onClick={() => bulk('rude')}>Mark as rude word</button><button className="btn sm" type="button" onClick={() => bulk('exclude')}>Ignore</button><button className="btn sm ghost" type="button" onClick={() => setSel(new Set())}>Clear</button></span></div>}
        <table style={{ minWidth: 960 }}><thead><tr><th style={{ width: 34 }}><input type="checkbox" checked={allSel} aria-label="Select all shown" onChange={(e) => setSel((s) => { const n = new Set(s); list.forEach((r) => (e.target.checked ? n.add(r.w) : n.delete(r.w))); return n; })} /></th><th>Keyword</th><th className="num">Heard</th><th>Status</th><th></th></tr></thead><tbody>
          {list.map((r) => { const todo = !r.ignored && r.st.t === 'Not set yet'; const stt = r.ignored ? { c: '', t: 'Ignored' } : r.st;
            return (
              <tr key={r.w} className={(r.ignored ? 'excl ' : '') + (todo ? 'todo' : '')}>
                <td><input type="checkbox" checked={sel.has(r.w)} aria-label={'Select ' + r.w} onChange={(e) => toggle(r.w, e.target.checked)} /></td>
                <td>{r.isNew ? <><Pill c="info">New</Pill> </> : null}<span className="kwlink" onClick={() => setDrawer(r.w)}>{r.w}</span>{r.h && !r.isNew ? <div className="sub">{r.h}</div> : null}</td>
                <td className="num">{r.n}</td><td><Pill c={stt.c}>{stt.t}</Pill></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{r.ignored ? <button className="btn sm" type="button" onClick={() => p.unignoreWord(r.w)}>Restore</button>
                  : todo ? <><button className="btn sm pri" type="button" disabled={lock} onClick={() => setSetFor({ w: r.w, preset: 'newtopic' })}>Make a topic</button> <button className="btn sm" type="button" onClick={() => setSetFor({ w: r.w, preset: 'alias' })}>Add to a topic</button> <button className="btn sm ghost" type="button" onClick={() => { p.ignoreWord(r.w); p.toast('Ignored “' + r.w + '”'); }}>Ignore</button></>
                  : <><button className="btn sm" type="button" onClick={() => setSetFor({ w: r.w })}>Change…</button> <button className="btn sm ghost" type="button" onClick={() => { p.ignoreWord(r.w); p.toast('Ignored “' + r.w + '”'); }}>Ignore</button></>}</td></tr>); })}
          {!list.length && <tr><td colSpan={5} className="sub">No keywords match. Words customers type are saved here automatically.</td></tr>}</tbody></table></div>
      {drawer && <KeywordDrawer word={drawer} count={p.kwMap[drawer]?.n ?? 0} onClose={() => setDrawer(null)} onSet={() => { setSetFor({ w: drawer }); setDrawer(null); }} />}
      {setFor && <SetKeywordModal word={setFor.w} preset={setFor.preset} onClose={() => setSetFor(null)} />}
    </>
  );
}
