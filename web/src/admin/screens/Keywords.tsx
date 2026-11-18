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
  const [openT, setOpenT] = useState<Set<string> | null>(null);                      // topic cards that are opened; until one is chosen, the first one is open
  const [allRest, setAllRest] = useState(false);
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
  const KSHADE: Record<KwKind, string> = { short: 'kws-0', slang: 'kws-1', meaning: 'kws-2', lang: 'kws-3' };
  type Row = (typeof list)[number];
  const stat = { heard: all.length, under: 0, notUnder: 0, ignored: 0 };
  all.forEach((r) => { if (r.ignored) stat.ignored++; else if (wordTopic(p.draft, p.merchant, r.w)) stat.under++; else if (r.st.t === 'Not set yet') stat.notUnder++; });
  const searching = !!Q || lang !== 'all';
  const isOpen = (tp: string) => searching || (openT ? openT.has(tp) : tp === byTopic[0]?.tp);
  const toggleT = (tp: string) => setOpenT((o) => { const n = new Set(o ?? (byTopic[0] ? [byTopic[0].tp] : [])); if (n.has(tp)) n.delete(tp); else n.add(tp); return n; });
  const chip = (r: Row, tag?: string): ReactNode => <span className={'kwchip' + (r.n ? '' : ' zero')} key={r.w} title={r.n ? undefined : 'nobody has typed this yet'}>
    {r.isNew ? <Pill c="info">New</Pill> : null}<span className="kwlink" role="button" tabIndex={0} onClick={() => setDrawer(r.w)} onKeyDown={(e) => { if (e.key === 'Enter') setDrawer(r.w); }}>{r.w}</span>{tag && <em>{tag}</em>}<small>{r.n}</small></span>;
  const restSorted = [...rest].sort((a, b) => b.n - a.n || a.w.localeCompare(b.w)); const restShown = allRest ? restSorted : restSorted.slice(0, 7); const restMax = Math.max(1, ...restSorted.map((x) => x.n));

  return (
    <div className="kwpage">
      <div><h2 style={{ margin: 0 }}>Keywords · {p.M.name}</h2><div className="sub">Every word customers type is saved here automatically. This page only shows them.</div></div>
      <div className="kwtiles">
        <div className="card kwtile"><small>Words heard</small><b>{stat.heard}</b><span>different words customers typed</span></div>
        <div className="card kwtile"><small>Under a topic</small><b>{stat.under}</b><span>the bot understands these</span></div>
        <div className="card kwtile"><small>Not under a topic</small><b>{stat.notUnder}</b><span>the bot does not know these yet</span></div>
        <div className="card kwtile"><small>Ignored</small><b>{stat.ignored}</b><span>left out on purpose</span></div>
      </div>
      <div className="card kwbar2">
        <div className="segs" role="group" aria-label="Show">{TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l} <span className="n">{counts[k]}</span></button>)}</div>
        <input type="search" placeholder="Search a word" aria-label="Filter keywords" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{LANG_NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="switch"><input type="checkbox" role="switch" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /><span className="track"><span className="thumb" /></span> Show words nobody typed</label>
        <span className="sub">{list.length} shown</span>
      </div>
      <div className="kwgrid">
        <div className="kwleft">
          {byTopic.map(({ tp, rows }) => {
            const main = rows.find((x) => x.r.w.toLowerCase() === tp.toLowerCase());
            const groups = groupKeywords(tp, rows.filter((x) => x !== main).map((x) => ({ variant: x.r.w, language: x.t!.language, kind: x.t!.kind, row: x.r })));
            const total = rows.reduce((n, x) => n + x.r.n, 0); const sum = (g: (typeof groups)[number]) => g.items.reduce((n, x) => n + x.row.n, 0);
            const open = isOpen(tp);
            return (
              <div className="card kwtopic" key={tp}>
                <button type="button" className="kwth" aria-expanded={open} onClick={() => toggleT(tp)}>
                  <span className="kwname">◆ {tp}</span>
                  <span className="kwstack">{groups.map((g) => <i key={g.kind} className={KSHADE[g.kind]} style={{ flex: Math.max(1, sum(g)) }} title={g.label + ': ' + sum(g)} />)}{main && <i className="kws-m" style={{ flex: Math.max(1, main.r.n) }} title={'The word "' + tp + '" itself: ' + main.r.n} />}</span>
                  <span className="kwtot"><b>{total}</b> times heard</span><span className="kwchev" aria-hidden="true">{open ? '▾' : '▸'}</span></button>
                {open && <div className="kwcols2">{KW_KINDS.map((k) => { const g = groups.find((x) => x.kind === k); const items = g ? (more.has(tp + k) || g.items.length <= FOLDK + 2 ? g.items : g.items.slice(0, FOLDK)) : [];
                  return <div className="kwcol2" key={k}><div className="kwch"><span><i className={KSHADE[k]} />{KW_LABEL[k]}</span><em>{g?.items.length ?? 0}</em></div>
                    {g ? <div className="kwchips">{items.map((x) => chip(x.row, k === 'lang' ? (LN[x.row.lg] ?? x.row.lg) : undefined))}</div> : <div className="sub">none heard</div>}
                    {g && g.items.length > FOLDK + 2 && <button type="button" className="btn sm ghost" onClick={() => setMore((o) => { const n = new Set(o); if (n.has(tp + k)) n.delete(tp + k); else n.add(tp + k); return n; })}>{more.has(tp + k) ? 'show fewer' : '+' + (g.items.length - FOLDK) + ' more'}</button>}</div>; })}
                  {main && <div className="sub kwmainw">The main word “{tp}” itself was heard {main.r.n} times.</div>}</div>}
              </div>
            );
          })}
          {byTopic.length > 0 && <div className="sub kwkey">Bar colours: {KW_KINDS.map((k, i) => <span key={k}>{i ? <span aria-hidden="true"> · </span> : null}<b className={'kwk ' + KSHADE[k]}>{KW_LABEL[k].toLowerCase()}</b></span>)}</div>}
          {!byTopic.length && <div className="card sub" style={{ padding: 16 }}>{rest.length || other.length ? 'No topic has a word that matches.' : 'No keywords match. Words customers type are saved here automatically.'}</div>}
        </div>
        <div className="kwright">
          {rest.length > 0 && <div className="card kwrest2"><h3>{tab === 'ignored' ? 'Ignored words' : 'Not under a topic yet'} · {rest.length}</h3>
            <div className="sub">{tab === 'ignored' ? 'Words left out on purpose.' : 'Most typed first. The bot does not know these words yet.'}</div>
            {restShown.map((r) => <div className="kwr" key={r.w}><span className="kwlink" role="button" tabIndex={0} onClick={() => setDrawer(r.w)} onKeyDown={(e) => { if (e.key === 'Enter') setDrawer(r.w); }}>{r.isNew ? <Pill c="info">New</Pill> : null} {r.w}</span>
              <span className="kwbar"><i style={{ width: Math.max(6, Math.round((r.n * 100) / restMax)) + '%' }} /></span><b>{r.n}</b></div>)}
            {restSorted.length > 7 && <button type="button" className="kwmore" onClick={() => setAllRest(!allRest)}>{allRest ? 'Show fewer' : 'Show all ' + restSorted.length}</button>}</div>}
          {other.length > 0 && <div className="card kwother2"><h3>Words with another job · {other.length}</h3><div className="sub">Not topics, so they are listed here.</div>
            {OTHER_GROUPS.map((g) => { const ws = other.filter((r) => g.test(r.st.t)); return ws.length ? <div className="kwgrow2" key={g.label}><div className="kwglbl">{g.label} · {ws.length}</div><div className="kwchips">{ws.map((r) => <span key={r.w} className="kwchip">{<span className="kwlink" role="button" tabIndex={0} onClick={() => setDrawer(r.w)} onKeyDown={(e) => { if (e.key === 'Enter') setDrawer(r.w); }}>{r.w}</span>}<small>{r.n}</small></span>)}</div></div> : null; })}</div>}
          <div className="kwhint">Click any word to see the chats that used it.</div>
        </div>
      </div>
      {drawer && <KeywordDrawer word={drawer} count={p.kwMap[drawer]?.n ?? 0} onClose={() => setDrawer(null)} />}
    </div>
  );
}
