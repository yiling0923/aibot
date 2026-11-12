import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePanel } from '../store';
import { LANGS, LANG_NAMES, LN, findDup, guessLang, emptyWords, slug } from '../model';

const TABS: [string, string][] = [['short', 'Topics'], ['aspect', 'Question words'], ['small', 'Greetings'], ['filler', 'Fillers'], ['block', 'Block lists']];
const SMALL_NAMES: Record<string, string> = { morning: 'Morning greetings', greeting: 'Other greetings', callout: 'Calling for attention', thanks: 'Thanks', bye: 'Goodbye', ack: 'Short acknowledgements' };
const ASPECT_NAMES: Record<string, string> = { time: 'Time (how long, pending, late)', limit: 'Limit (minimum, maximum)', change: 'Change (update, wrong)', hours: 'Opening hours', how: 'How to', problem: 'Problem: rejected, failed, complaint (a human takes over)', help: 'Help: "what to do" (ignored)' };
const BLOCK_GROUPS: [string, string, string][] = [
  ['abuse', 'Rude words: reply kindly first', 'A message with any of these gets a friendly reply that asks for the problem. The chat closes only if the customer keeps being rude (see Merchant settings).'],
  ['abuse_soft', 'Mild words: only when alone or with other rude words', 'Harmless in names or normal text (md, cao, 吊). They count as rude only when they are the whole message, or come with another rude word.'],
  ['human_request', 'Asking for a person: hand off', '"talk to agent", "real person", "转人工": the chat goes to a human straight away.'],
  ['injection', 'Rule-change attempts: hand off', "Messages that try to change the bot's rules go to a human."],
  ['reveal_verb', 'Secret requests: asking words', 'Words like "show", "tell", "what is".'],
  ['secret_object', 'Secret requests: secret things', 'Password, full bank, card or ID number. Asking word + secret thing = polite refusal.'],
  ['secret_phrase', 'Secret requests: whole phrases', 'Phrases such as "what is my otp".'],
  ['reveal_except', 'Secret requests: exception words', 'If the message also has "change", "reset" or "forgot", it is a normal question.'],
];

type Words = Record<string, string[]>;

export default function Topics() {
  const p = usePanel();
  const [tab, setTab] = useState('short'); const [q, setQ] = useState(''); const [lang, setLang] = useState('all');
  const [just, setJust] = useState<string[]>([]); const [fresh, setFresh] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null); const scroll = useRef(false);
  const lock = !p.isAdmin; const d = p.draft;
  const cur = !p.adv && tab === 'aspect' ? 'short' : tab;
  const [shown, setShown] = useState(0);
  useEffect(() => { setShown(document.querySelectorAll('#kwlists .chip').length); });

  useEffect(() => { if (scroll.current) { scroll.current = false; setTimeout(() => (listRef.current?.querySelector('.chip.new') || document.querySelector('.note .chip.new'))?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 60); } });

  const done = (msg: string, chip: string, word?: string) => {
    if (word) setFresh((s) => new Set(s).add(word.toLowerCase()));
    scroll.current = true; setJust((j) => [chip, ...j].slice(0, 8)); setQ(''); setLang('all'); p.toast(msg);
  };
  const dup = (v: string) => { const w = findDup(d, p.merchant, p.M.name, v); if (w.length) { p.toast('"' + v + '" is already ' + w[0] + '. Nothing was added.'); return true; } return false; };

  const matchQ = (w: string, extra?: string) => { const s = q.trim().toLowerCase(); return !s || w.toLowerCase().includes(s) || (!!extra && extra.toLowerCase().includes(s)); };
  const langOk = (l: string) => lang === 'all' || lang === l;

  const Chips = ({ byl, kind, k, extra, ro }: { byl: Words; kind: string; k: string; extra?: string; ro?: boolean }) => <>
    {LANGS.filter((l) => byl[l] && langOk(l)).map((l) => {
      const items = byl[l].map((w, i) => [w, i] as const).filter(([w]) => matchQ(w, extra)); if (!items.length) return null;
      return <div style={{ marginBottom: 6 }} key={l}><span className="lang">{LN[l]}</span><div className="chips" style={{ display: 'inline-flex' }}>
        {items.map(([w, i]) => <span key={i} className={'chip ' + (ro ? 'ro ' : '') + (fresh.has(w.toLowerCase()) ? 'new' : '')}>{w}{!ro && <button type="button" aria-label="Remove" onClick={() => remove(kind, k, l, i)}>×</button>}</span>)}</div></div>;
    })}</>;
  const Group = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => children ? <div className="group"><div className="lbl"><b>{title}</b><span className="lock">{sub}</span></div><div>{children}</div></div> : null;

  const remove = (kind: string, k: string, l: string, i: number) => p.edit((x, note) => {
    if (kind === 'alias') note('Removed short form "' + x.aliases[k][l].splice(i, 1)[0] + '" → ' + k);
    if (kind === 'aspect') note('Removed question word "' + x.aspects[k][l].splice(i, 1)[0] + '" (' + k + ')');
    if (kind === 'filler') note('Removed filler word "' + x.fillers[l].splice(i, 1)[0] + '"');
    if (kind === 'small') note('Removed greeting phrase "' + x.smalltalk[k][l].splice(i, 1)[0] + '"');
    if (kind === 'guard') note('Removed from block list "' + x.guard[k][l].splice(i, 1)[0] + '" (' + k + ')');
    if (kind === 'malias') note('Removed short form "' + x.mAliases[p.merchant].splice(i, 1)[0].variant + '" (' + p.M.name + ')');
  });

  const lists = () => {
    const out: ReactNode[] = [];
    if (cur === 'short') {
      const mine = (d.mAliases[p.merchant] || []).map((a, i) => [a, i] as const);
      const known = Object.keys(d.aliases);
      Object.entries(d.aliases).forEach(([k, byl]) => {
        const it = mine.filter(([a]) => a.canonical === k && langOk(a.language) && matchQ(a.variant, k));
        const inner = <>
          {it.length ? <div style={{ marginBottom: 6 }}><span className="lang">{p.M.name}</span><div className="chips" style={{ display: 'inline-flex' }}>{it.map(([a, i]) => <span key={i} className={'chip ' + (fresh.has(a.variant.toLowerCase()) ? 'new' : '')}>{a.variant}<button type="button" aria-label="Remove" onClick={() => remove('malias', '', '', i)}>×</button></span>)}</div></div> : null}
          <Chips byl={byl} kind="alias" k={k} extra={k} ro={lock} /></>;
        const has = it.length || LANGS.some((l) => byl[l] && langOk(l) && byl[l].some((w) => matchQ(w, k)));
        if (has) out.push(<Group key={k} title={k} sub={lock ? 'global · admin only' : 'global · all merchants'}>{inner}</Group>);
      });
      const odd = mine.filter(([a]) => !known.includes(a.canonical) && langOk(a.language) && matchQ(a.variant, a.canonical));
      if (odd.length) out.push(<Group key="odd" title={p.M.name + ' only'} sub="this merchant"><div className="chips">{odd.map(([a, i]) => <span className="chip" key={i}>{a.variant + ' → ' + a.canonical}<button type="button" aria-label="Remove" onClick={() => remove('malias', '', '', i)}>×</button></span>)}</div></Group>);
    }
    const chipBlock = (kind: string, k: string, byl: Words, title: string, sub: string, extra?: string) => {
      const has = LANGS.some((l) => byl[l] && langOk(l) && byl[l].some((w) => matchQ(w, extra)));
      if (has) out.push(<Group key={kind + k} title={title} sub={sub}><Chips byl={byl} kind={kind} k={k} extra={extra} ro={lock} /></Group>);
    };
    if (cur === 'aspect') Object.entries(d.aspects).forEach(([k, byl]) => chipBlock('aspect', k, byl, k, (ASPECT_NAMES[k] || '') + (lock ? ' · admin only' : ''), k));
    if (cur === 'small') Object.entries(d.smalltalk).forEach(([k, byl]) => chipBlock('small', k, byl, SMALL_NAMES[k] || k, lock ? 'global · admin only' : 'global', SMALL_NAMES[k]));
    if (cur === 'filler') chipBlock('filler', 'filler', d.fillers, 'Filler words', 'Words with no meaning of their own' + (lock ? ' · admin only' : ''));
    if (cur === 'block') BLOCK_GROUPS.forEach(([k, t, desc]) => chipBlock('guard', k, d.guard[k] || {}, t, desc, t));
    return out.length ? out : <div className="sub">Nothing matches the filter.</div>;
  };

  return (
    <div className="card"><div className="head"><div><h2>Topics</h2><div className="sub">Each topic has the keywords that mean it. The bot looks for them anywhere in the customer's sentence.</div></div></div>
      <div className="tabs" role="tablist" style={{ marginTop: 8 }}>{TABS.filter(([k]) => p.adv || k !== 'aspect').map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={k === cur} onClick={() => { setTab(k); setQ(''); setJust([]); setFresh(new Set()); }}>{l}</button>)}</div>
      {lock && <div className="note" style={{ margin: '8px 0' }}>You are signed in as staff: global lists are read-only. You can add short forms for your own merchant.</div>}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <details className="fold"><summary>＋ Add a topic or keyword</summary><div className="addbox"><AddBox tab={cur} dup={dup} done={done} /></div></details>
        {just.length > 0 && <div className="note" style={{ background: 'var(--okbg)' }}><b>Just added to the draft:</b> {just.map((x, i) => <span key={i}><span className="chip new ro">{x}</span> </span>)}</div>}
        <div className="filt"><input type="search" placeholder="Filter words" aria-label="Filter words" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
          <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>{[['all', 'All languages'], ...LANG_NAMES].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <span className="sub">{shown} words shown</span></div>
        <div id="kwlists" ref={listRef}>{lists()}</div>
      </div></div>
  );
}

/** The "add" forms, one per tab. Enter in any box presses the main button. */
function AddBox({ tab, dup, done }: { tab: string; dup: (v: string) => boolean; done: (msg: string, chip: string, word?: string) => void }) {
  const p = usePanel(); const d = p.draft; const lock = !p.isAdmin;
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string, dflt = '') => f[k] ?? dflt; const on = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const first = (o: object) => Object.keys(o)[0] || '';
  const row = (children: ReactNode, go: () => void) => <div className="addrow" style={{ marginTop: 0 }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); go(); } }}>{children}</div>;
  const langSel = (k: string) => <label className="fld"><span>Language</span><select value={v(k, 'en')} onChange={on(k)}>{LANGS.map((l) => <option key={l} value={l}>{LN[l]}</option>)}</select></label>;
  const need = (val: string, msg: string) => { if (!val) { p.toast(msg); return true; } return false; };
  const clear = () => setF({});

  const addAlias = () => {
    const w = v('al_v').trim().toLowerCase(), k = v('al_k', first(d.aliases)), l = v('al_l', 'en'), sc = v('al_s', 'm');
    if (need(w, 'Type the short form first') || dup(w)) return;
    if (sc === 'g' && p.isAdmin) { p.edit((x, note) => { (x.aliases[k][l] = x.aliases[k][l] || []).push(w); note('Added global short form "' + w + '" → ' + k); }); done('Added "' + w + '" → ' + k + ' (all merchants).', w + ' → ' + k + ' · all merchants', w); }
    else { p.edit((x, note) => { (x.mAliases[p.merchant] = x.mAliases[p.merchant] || []).push({ language: l, variant: w, canonical: k }); note('Added short form "' + w + '" → ' + k + ' (' + p.M.name + ')'); }); done('Added "' + w + '" → ' + k + ' (' + p.M.name + ' only). It is in the "' + k + '" group, on the ' + p.M.name + ' line.', w + ' → ' + k + ' · ' + p.M.name + ' only', w); }
    clear();
  };
  const addTopic = () => {
    const n = slug(v('tp_n')); if (need(n, 'Type a name first')) return;
    if (d.aliases[n]) return p.toast('The topic "' + n + '" already exists');
    const byl: Record<string, string[]> = { ...emptyWords(), en: [n] };
    v('tp_w').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).forEach((w) => { const l = guessLang(w); if (!byl[l].includes(w)) byl[l].push(w); });
    p.edit((x, note) => { x.aliases[n] = byl; note('Added topic "' + n + '"'); }); done('Topic "' + n + '" created. You can now assign it to entries.', 'topic: ' + n); clear();
  };
  const addWord = (kind: 'filler' | 'aspect' | 'small' | 'guard') => {
    const pre = ({ filler: 'fl', aspect: 'as', small: 'sm', guard: 'gd' })[kind];
    const w = v(pre + '_v').trim().toLowerCase(), l = v(pre + '_l', 'en');
    const k = kind === 'aspect' ? v('as_k', first(d.aspects)) : kind === 'small' ? v('sm_k', first(d.smalltalk)) : kind === 'guard' ? v('gd_k', 'abuse') : '';
    if (need(w, 'Type a word first') || dup(w)) return;
    p.edit((x, note) => {
      if (kind === 'filler') { (x.fillers[l] = x.fillers[l] || []).push(w); note('Added filler word "' + w + '"'); }
      if (kind === 'aspect') { (x.aspects[k][l] = x.aspects[k][l] || []).push(w); note('Added question word "' + w + '" (' + k + ')'); }
      if (kind === 'small') { (x.smalltalk[k][l] = x.smalltalk[k][l] || []).push(w); note('Added greeting phrase "' + w + '"'); }
      if (kind === 'guard') { (x.guard[k][l] = x.guard[k][l] || []).push(w); note('Added to block list "' + w + '" (' + k + ')'); }
    });
    if (kind === 'filler') done('Added filler word "' + w + '".', 'filler: ' + w, w);
    if (kind === 'aspect') done('Added question word "' + w + '" (' + k + ').', 'question word: ' + w + ' · ' + k, w);
    if (kind === 'small') done('Added greeting phrase "' + w + '".', 'greeting: ' + w + ' · ' + k, w);
    if (kind === 'guard') done('Added "' + w + '" to the block list.', 'block list: ' + w + ' · ' + k, w);
    clear();
  };

  if (tab === 'short') return <>
    {!lock && <div className="group"><div className="lbl"><b>New topic</b></div>{row(<>
      <label className="fld"><span>Topic name (one word, lowercase)</span><input type="text" placeholder="e.g. refund" value={v('tp_n')} onChange={on('tp_n')} /></label>
      <label className="fld w2"><span>Keywords (comma separated, any language)</span><input type="text" placeholder="e.g. refunds, bayaran balik, 退款" value={v('tp_w')} onChange={on('tp_w')} /></label>
      <button className="btn pri" type="button" onClick={addTopic}>Create topic</button></>, addTopic)}</div>}
    <div className="group"><div className="lbl"><b>Add a keyword</b></div>{row(<>
      <label className="fld"><span>Keyword</span><input type="text" placeholder="e.g. depoo" value={v('al_v')} onChange={on('al_v')} /></label>
      <label className="fld"><span>Topic</span><select value={v('al_k', first(d.aliases))} onChange={on('al_k')}>{Object.keys(d.aliases).map((k) => <option key={k}>{k}</option>)}</select></label>{langSel('al_l')}
      <label className="fld"><span>Applies to</span><select value={v('al_s', 'm')} onChange={on('al_s')}><option value="m">{p.M.name} only</option>{!lock && <option value="g">All merchants</option>}</select></label>
      <button className="btn pri" type="button" onClick={addAlias}>Add</button></>, addAlias)}</div></>;
  if (lock) return <div className="lock">Global lists are read-only for staff. You can request new words from an admin, or add short forms for your own merchant on the Short forms tab.</div>;
  if (tab === 'aspect') return row(<><label className="fld"><span>New word or phrase</span><input type="text" placeholder="e.g. cut off" value={v('as_v')} onChange={on('as_v')} /></label><label className="fld"><span>Question type</span><select value={v('as_k', first(d.aspects))} onChange={on('as_k')}>{Object.keys(d.aspects).map((k) => <option key={k}>{k}</option>)}</select></label>{langSel('as_l')}<button className="btn pri" type="button" onClick={() => addWord('aspect')}>Add</button></>, () => addWord('aspect'));
  if (tab === 'small') return row(<><label className="fld"><span>New phrase</span><input type="text" placeholder="e.g. hi moi" value={v('sm_v')} onChange={on('sm_v')} /></label><label className="fld"><span>Type</span><select value={v('sm_k', first(d.smalltalk))} onChange={on('sm_k')}>{Object.keys(d.smalltalk).map((k) => <option key={k} value={k}>{SMALL_NAMES[k] || k}</option>)}</select></label>{langSel('sm_l')}<button className="btn pri" type="button" onClick={() => addWord('small')}>Add</button></>, () => addWord('small'));
  if (tab === 'filler') return row(<><label className="fld"><span>New filler word</span><input type="text" placeholder="e.g. lh" value={v('fl_v')} onChange={on('fl_v')} /></label>{langSel('fl_l')}<button className="btn pri" type="button" onClick={() => addWord('filler')}>Add</button></>, () => addWord('filler'));
  if (tab === 'block') return row(<><label className="fld"><span>New word</span><input type="text" placeholder="word or phrase" value={v('gd_v')} onChange={on('gd_v')} /></label><label className="fld"><span>List</span><select value={v('gd_k', 'abuse')} onChange={on('gd_k')}>{BLOCK_GROUPS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>{langSel('gd_l')}<button className="btn pri" type="button" onClick={() => addWord('guard')}>Add</button></>, () => addWord('guard'));
  return null;
}
