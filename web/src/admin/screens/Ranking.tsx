import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { LANG_NAMES } from '../model';
import { usePanel } from '../store';
import type { RankData } from '../model';
import { ChgPill, Medal, Pill, Spark } from '../ui';
import { KeywordDrawer, RANK_TYPES } from './KeywordModals';
import { useT, tStatus } from '../i18n';

const TABS: [string, string][] = [['all', 'All'], ['new', 'New from chat'], ['unset', 'Needs a decision'], ['filler', 'Fillers'], ['slang', 'Abbreviations'], ['rude', 'Rude words'], ['meaning', 'Topics & other']];
const MEANING = ['topic', 'question', 'greeting', 'negation', 'other'];
const TIPS: Record<string, string> = { filler: 'Words with no meaning of their own. The bot ignores them.', slang: 'A short way to write a word. The bot turns it into the full word.', topic: 'A subject the bot can answer about.', question: 'Tells the bot what the customer wants to know.', rude: 'Rude or abusive. The bot replies kindly first.', greeting: 'A greeting, thanks or a call for attention.', negation: 'A word meaning "not".', other: 'Not classified yet.' };

export default function Ranking() {
  const p = usePanel(); const { t: T } = useT();
  const [week, setWeek] = useState(0); const [cache, setCache] = useState<Record<string, RankData>>({});
  const [tab, setTab] = useState('all'); const [q, setQ] = useState(''); const [lang, setLang] = useState('all'); const [showEx, setShowEx] = useState(false);
  const [sort, setSort] = useState<{ k: string; d: number }>({ k: 'rank', d: 1 });
  const [drawer, setDrawer] = useState<string | null>(null);
  const key = p.merchant + '|' + week; const data = cache[key];

  useEffect(() => { if (!cache[key]) api<RankData>(`/api/admin/ranking?merchant=${encodeURIComponent(p.merchant)}&week=${week}`).then((r) => setCache((c) => ({ ...c, [key]: r }))).catch((e: Error) => p.toast(T('Could not load: ') + e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

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
  const sumN = vis.reduce((s, r) => s + r.n, 0); void sumN;
  const th = (k: string, l: string, tip?: string, cls?: string) => <th className={'sort ' + (cls || '')} title={tip ? T(tip) : ''} onClick={() => setSort(sort.k === k ? { k, d: -sort.d } : { k, d: 1 })}>{T(l)}{sort.k === k ? (sort.d === 1 ? ' ▴' : ' ▾') : ''}</th>;
  const mxn = Math.max(1, ...list.map((x) => x.n));
  const label = data ? data.from + ' – ' + data.to : '';

  return (
    <>
      <div className="note viewonly" role="note"><b>{T('View only.')}</b> {T('This page shows the words customers wrote in the LiveChat chats linked to this bot. Nothing can be changed here. To decide what a word means, use the Topics page.')}</div>
      <div className="card kwtop"><div className="head"><div style={{ maxWidth: 560 }}><h2>{T('Keyword ranking')} · {p.M.name}</h2><div className="sub">{T('The words customers wrote most in {m} chats. Click a word to see its chats.', { m: p.M.name })}</div></div>
        <div className="wk" role="group" aria-label={T('Week')}><button type="button" aria-label={T('Previous week')} disabled={week <= -4} onClick={() => setWeek(week - 1)}>‹</button>
          <span className="wkl"><small>{week === 0 ? T('This week') : week === -1 ? T('Last week') : T('{n} weeks ago', { n: Math.abs(week) })}</small><b>{label}</b></span>
          <button type="button" aria-label={T('Next week')} disabled={week >= 0} onClick={() => setWeek(week + 1)}>›</button></div></div>
        <div className="kwfilter">
          <div className="segs" role="group" aria-label="Show">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{T(l)} <span className="n">{counts[k]}</span></button>)}</div>
          <div className="filt"><input type="search" placeholder={T('Filter keywords')} aria-label={T('Filter keywords')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">{T('All languages')}</option>{LANG_NAMES.map(([v, l]) => <option key={v} value={v}>{T(l)}</option>)}</select>
            <label className="tog" style={{ padding: 0 }}><input type="checkbox" checked={showEx} onChange={(e) => setShowEx(e.target.checked)} /> {T('Show excluded')}{p.ignored.size ? ' (' + p.ignored.size + ')' : ''}</label><span className="sub">{list.length} {T('shown')}</span>
</div></div></div>
      <div className="kwstats"><span className="st"><b>{total.toLocaleString()}</b> {T('words written this week')}</span><span className="st"><b>{vis.length}</b> {T('different keywords')}</span>
        <span className="st dim info" tabIndex={0} title={T('Count: how many times customers wrote it (repeats count). Share: its part of all keywords. Change: compared with the 7 days before. To decide what a word is, use the Keywords screen.')}>ⓘ {T('How to read this')}</span></div>
      {top.length > 0 && <>
        <div className="podium">{top.map((r, i) => (
          <div key={r.w} className={'pod p' + (i + 1)}><div className="pod-head"><Medal n={i + 1} /><div className="pod-main"><span className="kwlink pod-nm" onClick={() => setDrawer(r.w)}>{r.w}</span><div className="sub">{r.n} {T(r.n === 1 ? 'time' : 'times')} · {r.share.toFixed(2)}%</div></div><ChgPill c={r.c} /></div>
            <div className="pod-trend"><Spark v={r.series} w={260} h={38} /></div>
            <div className="pod-foot"><span className="pods">{r.isNew ? <Pill c="info">{T('New')}</Pill> : null}<Pill c={r.st.c}>{tStatus(T, r.st.t)}</Pill></span></div></div>))}</div></>}
      <div className="card scroll">
        <table style={{ minWidth: 940 }}><thead><tr>
          {th('rank', 'Rank', 'Position by count', ' ')}{th('w', 'Keyword')}{th('type', 'Type')}<th>{T('Trend')}</th>{th('n', 'Count', 'How many times customers wrote it. Repeating the same message counts.', 'num')}{th('c', 'Change', 'Compared with the previous 7 days.')}{th('st', 'Status', 'What the bot does with this word now.')}</tr></thead><tbody>
          {list.map((r) => { const ex = p.ignored.has(r.w); const ty = RANK_TYPES[r.t]; const todo = r.st.t === 'Not set yet';
            return (
              <tr key={r.w} className={(ex ? 'excl ' : '') + (todo && !ex ? 'todo' : '')}>
                <td><span className="rkn">{r.pos}</span></td>
                <td>{r.isNew ? <><Pill c="info">{T('New')}</Pill> </> : null}<span className="kwlink" onClick={() => setDrawer(r.w)}>{r.w}</span><div className="sub">{tStatus(T, r.h)}{r.live && !r.isNew ? ' · ' + T('+{n} from Test chat', { n: r.live }) : ''}{r.isNew && (r.live || 0) > 1 ? ' · ' + r.live + ' ' + T('times') : ''}</div></td>
                <td><Pill c={ty[1]} title={T(TIPS[r.t])}>{T(ty[0])}</Pill></td><td><Spark v={r.series} w={110} h={28} /></td><td className="num"><b>{r.n}</b><div className="mbar"><i style={{ width: Math.max(4, Math.round((r.n * 100) / mxn)) + '%' }} /></div></td><td><ChgPill c={r.c} /></td><td><Pill c={r.st.c}>{tStatus(T, r.st.t)}</Pill></td>
                </tr>); })}
          {!list.length && <tr><td colSpan={7}><div className="kwempty"><b>{T(vis.length ? 'No keyword matches this filter.' : 'No words this week.')}</b><span>{T(vis.length ? 'Try another tab, language or search.' : 'Customer messages appear here as soon as chats come in.')}</span></div></td></tr>}</tbody></table></div>
      {drawer && <KeywordDrawer word={drawer} count={vis.find((r) => r.w === drawer)?.n ?? p.kwMap[drawer]?.n ?? 0} share={vis.find((r) => r.w === drawer)?.share} onClose={() => setDrawer(null)} />}
    </>
  );
}
