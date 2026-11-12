import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { LANG_NAMES } from '../model';
import { usePanel } from '../store';
import type { RankData } from '../model';
import { ChgPill, Medal, Pill, Spark } from '../ui';
import { KeywordDrawer, RANK_TYPES } from './KeywordModals';
import { useAssign } from './assign';

const TABS: [string, string][] = [['all', 'All'], ['new', 'New from chat'], ['unset', 'Needs a decision'], ['filler', 'Fillers'], ['slang', 'Abbreviations'], ['rude', 'Rude words'], ['meaning', 'Topics & other']];
const MEANING = ['topic', 'question', 'greeting', 'negation', 'other'];
const TIPS: Record<string, string> = { filler: 'Words with no meaning of their own. The bot ignores them.', slang: 'A short way to write a word. The bot turns it into the full word.', topic: 'A subject the bot can answer about.', question: 'Tells the bot what the customer wants to know.', rude: 'Rude or abusive. The bot replies kindly first.', greeting: 'A greeting, thanks or a call for attention.', negation: 'A word meaning "not".', other: 'Not classified yet.' };

export default function Ranking() {
  const p = usePanel(); const assign = useAssign(); const lock = !p.isAdmin;
  const [week, setWeek] = useState(0); const [cache, setCache] = useState<Record<string, RankData>>({});
  const [tab, setTab] = useState('all'); const [q, setQ] = useState(''); const [lang, setLang] = useState('all'); const [showEx, setShowEx] = useState(false);
  const [sort, setSort] = useState<{ k: string; d: number }>({ k: 'rank', d: 1 }); const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const key = p.merchant + '|' + week; const data = cache[key];

  useEffect(() => { if (!cache[key]) api<RankData>(`/api/admin/ranking?merchant=${encodeURIComponent(p.merchant)}&week=${week}`).then((r) => setCache((c) => ({ ...c, [key]: r }))).catch((e: Error) => p.toast('Could not load: ' + e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  const all = useMemo(() => {
    const d = data || { rows: [], total: 0, from: '', to: '' };
    return d.rows.map((r) => ({ ...r, t: p.typeOf(r.w), st: p.status(r.w), isNew: !!p.kwMap[r.w]?.isNew, share: d.total ? (r.n / d.total) * 100 : 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, p.draft, p.merchant, p.kwMap]);
  type Row = (typeof all)[number] & { pos: number };
  const vis: Row[] = all.filter((r) => showEx || !p.ignored.has(r.w)).map((r, i) => ({ ...r, pos: i + 1 }));
  const total = data?.total || 0; const top = vis.slice(0, 3);
  const inTab = (r: Row, t: string) => t === 'all' || (t === 'new' ? !!(r.isNew || r.live) : t === 'unset' ? r.st.t === 'Not set yet' : t === 'meaning' ? MEANING.includes(r.t) : r.t === t);
  const counts = Object.fromEntries(TABS.map(([k]) => [k, vis.filter((r) => inTab(r, k)).length]));
  const Ql = q.trim().toLowerCase();
  let list = vis.filter((r) => inTab(r, tab) && (!Ql || r.w.toLowerCase().includes(Ql) || r.h.toLowerCase().includes(Ql)) && (lang === 'all' || r.lg === lang));
  if (tab === 'all' && !Ql && lang === 'all') list = list.filter((r) => r.pos > 3);
  const keyOf: Record<string, (r: Row) => string | number> = { rank: (r) => -r.n, n: (r) => r.n, share: (r) => r.share, c: (r) => r.c, type: (r) => r.t, st: (r) => r.st.t, w: (r) => r.w };
  list = list.slice().sort((a, b) => { const x = keyOf[sort.k](a), y = keyOf[sort.k](b); const rv = x > y ? 1 : x < y ? -1 : 0; return sort.k === 'rank' ? rv * sort.d : rv * -sort.d; });
  const allSel = list.length > 0 && list.every((r) => sel.has(r.w));
  const toggle = (w: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(w); else n.delete(w); return n; });
  const sumN = vis.reduce((s, r) => s + r.n, 0); void sumN;
  const th = (k: string, l: string, tip?: string, cls?: string) => <th className={'sort ' + (cls || '')} title={tip || ''} onClick={() => setSort(sort.k === k ? { k, d: -sort.d } : { k, d: 1 })}>{l}{sort.k === k ? (sort.d === 1 ? ' ▴' : ' ▾') : ''}</th>;
  const label = data ? data.from + ' – ' + data.to : '';

  const bulk = (kind: string) => {
    if (kind === 'clear') return setSel(new Set());
    const words = [...sel]; if (!words.length) return;
    const res = assign(words, kind); if (res.err) return p.toast(res.err);
    setSel(new Set()); p.toast(kind === 'exclude' ? words.length + ' keywords ignored' : res.done.length + ' keyword' + (res.done.length === 1 ? '' : 's') + ' added to the draft' + (res.skipped.length ? ' (' + res.skipped.length + ' already set)' : ''));
  };

  return (
    <>
      <div className="card"><div className="head"><div style={{ maxWidth: 560 }}><h2>Keyword ranking</h2><div className="sub">The words customers wrote most in {p.M.name} chats. Click a keyword to see the chats it was in. To decide what a word is, use the Keywords screen.</div></div>
        <div className="tools"><button className="btn" type="button" style={{ padding: '10px 16px', fontSize: 18 }} disabled={week <= -4} aria-label="Previous week" onClick={() => setWeek(week - 1)}>‹</button><span className="stat" style={{ padding: '10px 26px', minWidth: 230, alignItems: 'center', textAlign: 'center' }}><b style={{ fontSize: 13 }}>Date</b><span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span></span><button className="btn" type="button" style={{ padding: '10px 16px', fontSize: 18 }} disabled={week >= 0} aria-label="Next week" onClick={() => setWeek(week + 1)}>›</button></div></div></div>
      <div className="quiet" style={{ margin: '-4px 2px 0' }}><b>{total.toLocaleString()}</b> words written this week · <b>{vis.length}</b> different keywords · <b>{counts.unset}</b> need a decision</div>
      {top.length > 0 && <>
        <div className="sub" style={{ margin: '2px 2px -4px' }}>Count: how many times customers wrote it (repeats count). Share: its part of all keywords. Change: compared with the 7 days before. Click a keyword to see its chats.</div>
        <div className="podium">{top.map((r, i) => (
          <div key={r.w} className={'pod p' + (i + 1)}><div className="pod-head"><Medal n={i + 1} /><div className="pod-main"><span className="kwlink pod-nm" onClick={() => setDrawer(r.w)}>{r.w}</span><div className="sub">{r.n} time{r.n === 1 ? '' : 's'} · {r.share.toFixed(2)}%</div></div><ChgPill c={r.c} /></div>
            <div className="pod-trend"><Spark v={r.series} w={260} h={38} /></div>
            <div className="pod-foot"><span className="pods">{r.isNew ? <Pill c="info">New</Pill> : null}<Pill c={r.st.c}>{r.st.t}</Pill></span></div></div>))}</div></>}
      <div className="card rkfilter"><div className="head"><div className="segs" role="group" aria-label="Show">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setSel(new Set()); }}>{l} <span className="n">{counts[k]}</span></button>)}</div>
        <div className="filt"><input type="search" placeholder="Filter keywords" aria-label="Filter keywords" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} />
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{LANG_NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label className="tog" style={{ padding: 0 }}><input type="checkbox" checked={showEx} onChange={(e) => setShowEx(e.target.checked)} /> Show excluded{p.ignored.size ? ' (' + p.ignored.size + ')' : ''}</label><span className="sub">{list.length} keywords shown</span></div></div></div>
      <div className="card scroll">
        {sel.size > 0 && <div className="bulk"><b>{sel.size} selected</b><span className="tools">{[['filler', 'Mark as filler'], ['rude', 'Mark as rude word'], ['mild', 'Mark as mild rude word']].map(([k, l]) => <button key={k} className="btn sm" type="button" disabled={lock} onClick={() => bulk(k)}>{l}</button>)}<button className="btn sm" type="button" onClick={() => bulk('exclude')}>Exclude</button><button className="btn sm ghost" type="button" onClick={() => bulk('clear')}>Clear</button></span>{lock && <span className="lock">Only admins can change these lists.</span>}</div>}
        <table style={{ minWidth: 940 }}><thead><tr><th style={{ width: 34 }}><input type="checkbox" checked={allSel} aria-label="Select all shown" onChange={(e) => setSel((s) => { const n = new Set(s); list.forEach((r) => (e.target.checked ? n.add(r.w) : n.delete(r.w))); return n; })} /></th>
          {th('rank', 'Rank', 'Position by count', ' ')}{th('w', 'Keyword')}{th('type', 'Type')}<th>Trend</th>{th('n', 'Count', 'How many times customers wrote it. Repeating the same message counts.', 'num')}{th('c', 'Change', 'Compared with the previous 7 days.')}{th('st', 'Status', 'What the bot does with this word now.')}<th></th></tr></thead><tbody>
          {list.map((r) => { const ex = p.ignored.has(r.w); const ty = RANK_TYPES[r.t]; const todo = r.st.t === 'Not set yet';
            return (
              <tr key={r.w} className={(ex ? 'excl ' : '') + (todo && !ex ? 'todo' : '')}>
                <td><input type="checkbox" checked={sel.has(r.w)} aria-label={'Select ' + r.w} onChange={(e) => toggle(r.w, e.target.checked)} /></td><td>{r.pos}</td>
                <td>{r.isNew ? <><Pill c="info">New</Pill> </> : null}<span className="kwlink" onClick={() => setDrawer(r.w)}>{r.w}</span><div className="sub">{r.h}{r.live && !r.isNew ? ' · +' + r.live + ' from Test chat' : ''}{r.isNew && (r.live || 0) > 1 ? ' · ' + r.live + ' times' : ''}</div></td>
                <td><Pill c={ty[1]} title={TIPS[r.t]}>{ty[0]}</Pill></td><td><Spark v={r.series} w={110} h={28} /></td><td className="num">{r.n}</td><td><ChgPill c={r.c} /></td><td><Pill c={r.st.c}>{r.st.t}</Pill></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{ex ? <button className="btn sm" type="button" onClick={() => p.unignoreWord(r.w)}>Restore</button> : null}</td></tr>); })}
          {!list.length && <tr><td colSpan={10} className="sub">No keyword matches.</td></tr>}</tbody></table></div>
      {drawer && <KeywordDrawer word={drawer} count={vis.find((r) => r.w === drawer)?.n ?? p.kwMap[drawer]?.n ?? 0} share={vis.find((r) => r.w === drawer)?.share} onClose={() => setDrawer(null)} />}
    </>
  );
}
