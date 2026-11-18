import { useState, type ReactNode } from 'react';
import { KW_KINDS, KW_LABEL, LANG_NAMES, LN, groupKeywords, topicNames, wordTopic, type KwKind } from '../model';
import { usePanel } from '../store';
import { Pill } from '../ui';
import { KeywordDrawer } from './KeywordModals';

const FOLDK = 12;                                                             // words shown in a column before "+N more"
const OTHER_GROUPS: { label: string; test: (t: string) => boolean }[] = [
  { label: 'Rude words', test: (t) => t.startsWith('Rude') }, { label: 'Question words', test: (t) => t.startsWith('Question word') },
  { label: 'Fillers', test: (t) => t === 'Filler' }, { label: 'Greetings', test: (t) => t.startsWith('Greeting') },
  { label: 'Other', test: (t) => !(t.startsWith('Rude') || t.startsWith('Question word') || t === 'Filler' || t.startsWith('Greeting')) },
];
const TABS: [string, string][] = [['all', 'All'], ['unassigned', 'Not assigned'], ['assigned', 'Assigned'], ['ignored', 'Ignored']];

export default function Keywords() {
  const p = usePanel();
  const [tab, setTab] = useState('all'); const [q, setQ] = useState(''); const [lang, setLang] = useState('all');
  const [drawer, setDrawer] = useState<string | null>(null);                      // the page only shows words: a click opens the chats that used one

  const [showAll, setShowAllState] = useState(() => { try { return localStorage.getItem('kwShowAll') === '1'; } catch { return false; } });   // also show the words of each main keyword that nobody has typed yet
  const setShowAll = (v: boolean) => { setShowAllState(v); try { localStorage.setItem('kwShowAll', v ? '1' : '0'); } catch { /* ignore */ } };
  const [more, setMore] = useState<Set<string>>(new Set());                          // columns opened to show every word
  const all = p.kw.map((k) => ({ ...k, st: p.status(k.w), ignored: p.ignored.has(k.w) }));
  const inTab = (r: (typeof all)[number], t: string) => t === 'all' || (t === 'ignored' ? r.ignored : t === 'unassigned' ? !r.ignored && r.st.t === 'Not set yet' : !r.ignored && r.st.t !== 'Not set yet');
  const counts = Object.fromEntries(TABS.map(([k]) => [k, all.filter((r) => inTab(r, k)).length]));
  const Q = q.trim().toLowerCase();
  // the words each main keyword knows but no customer has typed: shown with 0 when asked
  const heard = new Set(all.map((r) => r.w.toLowerCase())); const seen = new Set<string>();
  const topicsAll = topicNames(p.draft, p.merchant);
  const synth = (showAll ? topicsAll.flatMap((tp) => [
    ...Object.entries(p.draft.aliases[tp] ?? {}).flatMap(([l, ws]) => ws.map((w) => [w, l] as const)),
    ...(p.draft.mAliases[p.merchant] ?? []).filter((a) => a.canonical === tp).map((a) => [a.variant, a.language] as const),
  ]) : []).filter(([w]) => { const k = w.toLowerCase(); if (heard.has(k) || seen.has(k)) return false; seen.add(k); return true; })
    .map(([w, l]) => ({ w, lg: l, n: 0, ignored: false, h: '', isNew: false, lastTs: 0, st: p.status(w) }) as unknown as (typeof all)[number]);
  const list = [...all, ...synth].filter((r) => inTab(r, tab) && (!Q || r.w.toLowerCase().includes(Q) || r.h.toLowerCase().includes(Q)) && (lang === 'all' || r.lg === lang))
    .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0) || b.n - a.n || a.w.localeCompare(b.w));
  const topics = topicNames(p.draft, p.merchant);

  /** The words customers typed, under their main keyword: short forms, slang, same meaning, other languages. Words with no topic stay in a table below. */
  const placed = list.map((r) => ({ r, t: r.ignored ? null : wordTopic(p.draft, p.merchant, r.w) }));
  const byTopic = topics.map((tp) => ({ tp, rows: placed.filter((x) => x.t?.topic === tp) })).filter((x) => x.rows.length);
  const rest = placed.filter((x) => !x.t && (x.r.ignored || x.r.st.t === 'Not set yet')).map((x) => x.r);          // really waiting for a main keyword (or ignored)
  const other = placed.filter((x) => !x.t && !x.r.ignored && x.r.st.t !== 'Not set yet').map((x) => x.r);       // already used for something else: filler, rude word, question word, greeting
  const KSHADE: Record<KwKind, string> = { short: 'g-short', slang: 'g-slang', meaning: 'g-meaning', lang: 'g-lang' };
  type Row = (typeof list)[number];
  const wordRow = (r: Row, mx: number, tag?: string): ReactNode => <div className="kwrow" key={r.w}>
    <span className="kwwd">{r.isNew ? <Pill c="info">New</Pill> : null}<span className="kwlink" onClick={() => setDrawer(r.w)}>{r.w}</span>{tag && <span className="lang">{tag}</span>}</span>
    <div className="kwbar">{r.n > 0 && <i style={{ width: Math.max(8, Math.round((r.n * 100) / mx)) + '%' }} />}</div><b className={'kwn' + (r.n ? '' : ' zero')} title={r.n ? 'times heard' : 'nobody has typed this yet'}>{r.n}</b></div>;
  const mainView = (
    <>
      <div className="kwtools"><label className="switch"><input type="checkbox" role="switch" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /><span className="track"><span className="thumb" /></span> Also show the words nobody has typed yet</label>
        <div className="kwlegend" title="The bar on each main keyword shows how much of the typing came from each group.">{KW_KINDS.map((k) => <span key={k}><i className={KSHADE[k]} />{KW_LABEL[k]}</span>)}</div></div>
      {byTopic.map(({ tp, rows }) => {
        const main = rows.find((x) => x.r.w.toLowerCase() === tp.toLowerCase());
        const groups = groupKeywords(tp, rows.filter((x) => x !== main).map((x) => ({ variant: x.r.w, language: x.t!.language, kind: x.t!.kind, row: x.r })));
        const total = rows.reduce((n, x) => n + x.r.n, 0); const sum = (g: (typeof groups)[number]) => g.items.reduce((n, x) => n + x.row.n, 0);
        return (
          <div className="card kwmain" key={tp}>
            <div className="kwhead"><span className="kwname">◆ {tp}</span>
              <div className="kwstack">{groups.map((g) => <i key={g.kind} className={KSHADE[g.kind]} style={{ flex: sum(g) }} title={g.label + ': ' + sum(g)} />)}{main && <i className="s0" style={{ flex: main.r.n }} title={'The word "' + tp + '" itself: ' + main.r.n} />}</div>
              <span className="kwtotal"><b>{total}</b> times heard</span></div>
            <div className="kwcols">{KW_KINDS.map((k) => { const g = groups.find((x) => x.kind === k); const mx = Math.max(1, ...(g?.items.map((x) => x.row.n) ?? [1]));
              return <div className={'kwcol ' + KSHADE[k]} key={k}><div className="kwcolh"><span>{KW_LABEL[k]}</span><em>{g?.items.length ?? 0}</em></div>
                {g ? (more.has(tp + k) || g.items.length <= FOLDK + 2 ? g.items : g.items.slice(0, FOLDK)).map((x) => wordRow(x.row, mx, k === 'lang' ? (LN[x.row.lg] ?? x.row.lg) : undefined)) : <div className="sub">none heard</div>}
                {g && g.items.length > FOLDK + 2 && <button type="button" className="btn sm ghost" onClick={() => setMore((o) => { const n = new Set(o); if (n.has(tp + k)) n.delete(tp + k); else n.add(tp + k); return n; })}>{more.has(tp + k) ? 'show fewer' : '+' + (g.items.length - FOLDK) + ' more'}</button>}</div>; })}</div>
            {main && <div className="sub kwmainw">The main word “{tp}” itself was heard {main.r.n} times.</div>}
          </div>
        );
      })}
      {rest.length > 0 && <div className="card kwrest"><div className="head"><div><h3 style={{ margin: 0 }}>{tab === 'ignored' ? 'Ignored words' : 'Not under a main keyword yet'} · {rest.length}</h3>
        {tab !== 'ignored' && <div className="sub">Words customers type that the bot does not know yet.</div>}</div></div>
        <table className="kwtable g-meaning"><tbody>{rest.map((r) => <tr key={r.w}>
          <td>{r.isNew ? <><Pill c="info">New</Pill> </> : null}<span className="kwlink" onClick={() => setDrawer(r.w)}><b>{r.w}</b></span>{r.h && !r.isNew ? <div className="sub">{r.h}</div> : null}</td>
          <td className="kwbc"><div className="kwbar"><i style={{ width: Math.max(6, Math.round((r.n * 100) / Math.max(1, ...rest.map((x) => x.n)))) + '%' }} /></div></td>
          <td className="num">{r.n}</td>
          </tr>)}</tbody></table></div>}
      {other.length > 0 && <div className="card kwother"><div className="head"><div><h3 style={{ margin: 0 }}>Words with another job · {other.length}</h3><div className="sub">Not main keywords, so they are not shown above. Click a word to see the chats that used it.</div></div></div>
        {OTHER_GROUPS.map((g) => { const ws = other.filter((r) => g.test(r.st.t)); return ws.length ? <div className="kwgrow" key={g.label}><div className="kwglbl">{g.label}<em>{ws.length}</em></div><div>{ws.map((r) => <span key={r.w} className="kwpill" role="button" tabIndex={0} onClick={() => setDrawer(r.w)} onKeyDown={(e) => { if (e.key === 'Enter') setDrawer(r.w); }}>{r.w}<small>{r.n}</small></span>)}</div></div> : null; })}</div>}
      {!byTopic.length && !rest.length && !other.length && <div className="card sub">No keywords match. Words customers type are saved here automatically.</div>}
    </>
  );

  return (
    <>
      <div className="card kwtop">
        <div className="head"><div><h2>Keywords · {p.M.name}</h2><div className="sub">Every word customers type is saved here automatically. This page only shows them.</div></div></div>
        <div className="kwfilter">
          <div className="segs" role="group" aria-label="Show">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l} <span className="n">{counts[k]}</span></button>)}</div>
          <div className="filt"><input type="search" placeholder="Filter keywords" aria-label="Filter keywords" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{LANG_NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <span className="sub">{list.length} shown</span></div></div></div>
      {mainView}
      {drawer && <KeywordDrawer word={drawer} count={p.kwMap[drawer]?.n ?? 0} onClose={() => setDrawer(null)} />}
    </>
  );
}
