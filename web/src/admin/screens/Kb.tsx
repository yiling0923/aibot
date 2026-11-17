import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { ASPECT_LABEL, CORE_LANGS, LANGS, LN, addOwnTopic, clone, entryProblems, langState, slug, topicList, topicNames, type Entry } from '../model';
import { Modal, Pill } from '../ui';

type Tr = { question_examples: string[]; answer_text: string };
type Ed = Entry & { useAspect: boolean; tab: string; sug: Record<string, string[]>; newTopic: string; newTopicW: string; newEx: string };
const blank = (merchant: string): Entry => ({ id: 0, merchant, intent_key: '', topic: '', aspect: null, topic_optional: false, status: 'live', category: 'General', translations: {} });
const TYPE_NOTE: Record<string, string> = { answer: 'The bot answers with this text.', needs_staff: 'A person must answer this (for example the customer\'s own account). The bot hands the chat over instead of answering.', promotion: 'An answer that is only true for a while. Set an end date: after it the bot stops using this entry.' };
/** What a guided answer can ask the customer for after the answer. */
const STEP_KINDS: [string, string][] = [['receipt', 'A receipt picture'], ['amount', 'An amount'], ['username', 'The username'], ['phone', 'A phone number'], ['text', 'A short reply']];
const STEP_LANGS = ['en', 'ms', 'zh'] as const;
const trOf = (e: Entry, l: string): Tr => (e.translations as Record<string, Tr>)[l] || { question_examples: [], answer_text: '' };

export default function Kb() {
  const p = usePanel();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all'); const [topicF, setTopicF] = useState('all');
  const [ed, setEd] = useState<Ed | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());                 // entries ticked for a bulk action
  useEffect(() => { setSel(new Set()); }, [p.merchant]);

  const all = p.draft.kb.filter((e) => e.merchant === p.merchant);
  const needs = all.filter((e) => entryProblems(e).length).length; const drafts = all.length - all.filter((e) => e.status === 'live').length;
  const topicsIn = [...new Set(all.map((e) => e.topic).filter(Boolean))].sort();
  const list = all.filter((e) => (status === 'all' || (status === 'needs' ? entryProblems(e).length > 0 : e.status === status)) && (topicF === 'all' || e.topic === topicF) && (!q || (e.intent_key + ' ' + LANGS.map((l) => trOf(e, l).answer_text).join(' ')).toLowerCase().includes(q.toLowerCase())));
  const live = all.filter((e) => e.status === 'live').length, miss = all.filter((e) => CORE_LANGS.some((l) => langState(e, l) !== 'on')).length;

  const picked = list.filter((e) => sel.has(e.id));
  const allShown = list.length > 0 && list.every((e) => sel.has(e.id));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** A draft the bot could use if it were live: it has an answer and at least 3 example questions (no "TO WRITE", no other problem). */
  const readyDrafts = all.filter((e) => e.status === 'draft' && entryProblems({ ...e, status: 'live' }).length === 0);
  const setStatusOf = (ids: Set<number>, to: 'live' | 'draft') => {
    const n = all.filter((e) => ids.has(e.id) && e.status !== to).length; if (!n) return p.toast('Nothing to change: they are already ' + to);
    p.edit((d, note) => { d.kb.forEach((e) => { if (ids.has(e.id) && e.merchant === p.merchant && e.status !== to) { e.status = to; e.dirty = true; } }); note(`Set ${n} entr${n === 1 ? 'y' : 'ies'} ${to} (${p.M.name})`); });
    setSel(new Set()); p.toast(`Set ${n} entr${n === 1 ? 'y' : 'ies'} ${to} in the draft. ${to === 'live' ? 'Press Publish to make them live for customers.' : 'Press Publish to take them off.'}`);
  };
  const deleteSel = () => {
    if (!picked.length || !window.confirm(`Delete ${picked.length} entr${picked.length === 1 ? 'y' : 'ies'}? You can still go back by not publishing, or from History.`)) return;
    const ids = new Set(picked.map((e) => e.id));
    p.edit((d, note) => { d.kb = d.kb.filter((e) => !(ids.has(e.id) && e.merchant === p.merchant)); note(`Deleted ${ids.size} entr${ids.size === 1 ? 'y' : 'ies'} (${p.M.name})`); });
    setSel(new Set());
  };

  const open = (e: Entry | null) => {
    const src = e ? clone(e) : blank(p.merchant);
    LANGS.forEach((l) => { (src.translations as Record<string, Tr>)[l] = trOf(src, l); });
    setEd({ ...src, useAspect: !!src.aspect, tab: 'en', sug: {}, newTopic: '', newTopicW: '', newEx: '' });
  };
  return (
    <>
      <div className="card"><div className="head"><div><h2>Knowledge base · {p.M.name}</h2><div className="sub">What the bot may answer for this merchant. Only live entries are used.</div></div>
        <button className="btn pri" type="button" onClick={() => open(null)}>Add entry</button></div>
        {miss ? <div className="kwstats"><span className="st dim" title="Entries missing an answer or 3+ examples in a main language">{miss} missing a language or examples</span></div> : null}
        <div className="filt-row" style={{ marginTop: 12 }}>
          <div className="segs" role="group" aria-label="Show">{([['all', 'All', all.length], ['live', 'Live', live], ['draft', 'Draft', drafts], ['needs', 'Needs work', needs]] as const).map(([k, l, n]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l} <span className="n">{n}</span></button>)}</div>
          <input type="search" placeholder="Search entries or answers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
          <select aria-label="Topic" value={topicF} onChange={(e) => setTopicF(e.target.value)}><option value="all">All topics</option>{topicsIn.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <span className="sub">{list.length} shown</span>
          {readyDrafts.length > 0 && <button className="btn sm pri" type="button" title="Drafts that have an answer and at least 3 example questions. Entries that still say TO WRITE are left as drafts." onClick={() => setStatusOf(new Set(readyDrafts.map((e) => e.id)), 'live')}>Set {readyDrafts.length} ready draft{readyDrafts.length === 1 ? '' : 's'} live</button>}</div></div>
      {picked.length > 0 && <div className="bulkbar" role="region" aria-label="Selected entries"><b>{picked.length} selected</b>
        <button className="btn sm pri" type="button" onClick={() => setStatusOf(new Set(picked.map((e) => e.id)), 'live')}>Set live</button>
        <button className="btn sm" type="button" onClick={() => setStatusOf(new Set(picked.map((e) => e.id)), 'draft')}>Set draft</button>
        <button className="btn sm bad" type="button" onClick={deleteSel}>Delete</button>
        <button className="btn sm ghost" type="button" onClick={() => setSel(new Set())}>Clear</button></div>}
      <div className="card scroll"><table><thead><tr><th style={{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(list.map((e) => e.id)))} /></th><th>Entry</th><th>Topic{p.adv ? ' · question' : ''}</th><th>Languages</th><th>Questions</th><th>Answer (English)</th><th>Status</th></tr></thead><tbody>
        {list.map((e) => (
          <tr className="row" key={e.id} onClick={() => open(e)}>
            <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" aria-label={'Select ' + e.intent_key} checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></td>
            <td><b>{e.intent_key}</b>{entryProblems(e).length ? <span className="pill warn" style={{ marginLeft: 8 }} title={entryProblems(e).join(' ')}>needs work</span> : null}</td>
            <td>{e.topic ? <Pill c="info">{e.topic}</Pill> : <Pill c="bad">missing</Pill>}{p.adv && e.aspect ? <> <Pill>{e.aspect}{e.topic_optional ? ' (alone)' : ''}</Pill></> : null}</td>
            <td><div className="dots">{LANGS.map((l) => { const s = langState(e, l); return <span key={l} className={'dot ' + s} title={`${LN[l]}: ${s === 'on' ? 'complete' : s === 'part' ? 'needs 3+ examples or an answer' : 'empty'}`}>{LN[l]}</span>; })}</div></td>
            <td className="num">{(() => { const n = trOf(e, 'en').question_examples.length; return <span className={'pill' + (n < 3 ? ' warn' : '')} title={n < 3 ? 'Add at least 3 example questions' : 'Example questions in English'}>{n}</span>; })()}</td>
            <td><div className="clamp2">{trOf(e, 'en').answer_text}</div></td>
            <td><Pill c={e.status === 'live' ? 'ok' : 'warn'}>{e.status}</Pill>{e.steps?.length ? <> <Pill c="info" >asks {e.steps.length}</Pill></> : null}{e.entry_type && e.entry_type !== 'answer' ? <> <Pill c="info">{e.entry_type === 'needs_staff' ? 'needs staff' : 'promotion'}</Pill></> : null}{e.ends_on ? <> <Pill c={e.ends_on < new Date().toISOString().slice(0, 10) ? 'bad' : 'info'}>{e.ends_on < new Date().toISOString().slice(0, 10) ? 'ended ' : 'until '}{e.ends_on}</Pill></> : null}{(e as Entry).dirty ? <> <Pill c="info">edited</Pill></> : null}</td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={7} className="sub">No entries match.</td></tr>}
      </tbody></table></div>
      {ed && <Editor ed={ed} setEd={setEd} onClose={() => setEd(null)} />}
    </>
  );
}

function Editor({ ed, setEd, onClose }: { ed: Ed; setEd: (e: Ed) => void; onClose: () => void }) {
  const p = usePanel();
  const set = (patch: Partial<Ed>) => setEd({ ...ed, ...patch });
  const t = trOf(ed, ed.tab);
  const setTr = (patch: Partial<Tr>, lang = ed.tab) => setEd({ ...ed, translations: { ...ed.translations, [lang]: { ...trOf(ed, lang), ...patch } } });
  const sug = ed.sug[ed.tab] || [];
  const [busy, setBusy] = useState(false);

  /** Asks the AI to translate the English answer and examples into other languages. The result is only a draft in the editor: nothing is saved until "Save to draft". */
  const translateTo = async (langs: string[]) => {
    const en = trOf(ed, 'en');
    if (!en.answer_text.trim()) return p.toast('Write the English answer first, then translate it.');
    setBusy(true);
    let next = { ...ed.translations } as Record<string, Tr>; const done: string[] = [], failed: string[] = [];
    for (const l of langs) {
      const cur = trOf({ ...ed, translations: next as Entry['translations'] }, l);
      if (cur.answer_text.trim() && !confirm(`Replace the current ${LN[l]} answer with a new translation?`)) continue;
      try {
        const r = await api<{ answer: string; examples: string[] }>('/api/admin/translate', { merchant: p.merchant, from: 'en', to: l, answer: en.answer_text, examples: en.question_examples, style: p.draft.settings[p.merchant]?.ai_instructions ?? '' });
        const have = new Set(cur.question_examples.map((x) => x.toLowerCase()));
        next = { ...next, [l]: { answer_text: r.answer, question_examples: [...cur.question_examples, ...r.examples.filter((x) => !have.has(x.toLowerCase()))] } };
        done.push(LN[l]);
      } catch (e) { failed.push(`${LN[l]}: ${(e as Error).message}`); }
    }
    setEd({ ...ed, translations: next as Entry['translations'] }); setBusy(false);
    if (failed.length) p.toast(failed[0]);
    else if (done.length) p.toast(`Translated to ${done.join(' and ')}. Please check the wording, then save.`);
  };

  const addEx = () => { const v = ed.newEx.trim(); if (v) setEd({ ...ed, newEx: '', translations: { ...ed.translations, [ed.tab]: { ...t, question_examples: [...t.question_examples, v] } } }); };
  const suggest = () => {
    const base = t.question_examples[0] || (ed.intent_key || 'question').replace(/_/g, ' ');
    const sfx = ({ en: ['pls', 'boss', 'ya'], ms: ['tolong', 'boss', 'lah'], zh: ['请问', '老板', '呀'], vi: ['nhé', 'shop', 'giúp mình'], th: ['ค่ะ', 'ครับ', 'หน่อย'], tl: ['po', 'boss', 'naman'] } as Record<string, string[]>)[ed.tab];
    const out = ed.tab === 'zh' ? [sfx[0] + base, base + sfx[2], sfx[1] + base] : [base + ' ' + sfx[0], sfx[1] + ' ' + base, base + ' ' + sfx[2]];
    set({ sug: { ...ed.sug, [ed.tab]: out } });
  };

  const save = () => {
    if (!ed.intent_key.trim()) return p.toast('Give the entry a name first');
    if (!trOf(ed, 'en').answer_text.trim()) return p.toast('Add the English answer first');
    let topic = ed.topic; let newTopic = '';
    if (topic === '__new') { newTopic = slug(ed.newTopic); if (!newTopic) return p.toast('Type a name for the new topic'); topic = newTopic; }
    if (!topic) return p.toast('Choose a topic first. It is required.');
    if (ed.useAspect && !ed.aspect) return p.toast('Choose a question type, or untick "Add a question type".');
    const { useAspect, tab, sug: _s, newTopic: _n, newTopicW, newEx: _e, ...rest } = ed; void tab;
    const steps = (ed.steps ?? []).map((x) => ({ kind: x.kind, ask: Object.fromEntries(Object.entries(x.ask ?? {}).map(([l, v]) => [l, (v ?? '').trim()]).filter(([, v]) => v)) as Record<string, string> })).filter((x) => x.ask.en || Object.keys(x.ask).length);
    if (steps.some((x) => !x.ask.en)) return p.toast('Write the English text of each question to the customer (section 5), or remove it');
    const clean: Entry = { ...rest, steps: steps.length ? steps : undefined, intent_key: ed.intent_key.trim(), topic, aspect: useAspect ? ed.aspect : null, topic_optional: useAspect ? ed.topic_optional : false };
    p.edit((d, note) => {
      if (newTopic && !topicNames(d, p.merchant).includes(newTopic)) {                 // a topic made here belongs to this merchant (the plan: each client owns its topic list)
        addOwnTopic(d, p.merchant, newTopic, newTopicW.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)); note('Added topic "' + newTopic + '" (' + p.M.name + ')');
      }
      if (ed.id) { const i = d.kb.findIndex((e) => e.id === ed.id); d.kb[i] = { ...d.kb[i], ...clean, dirty: true }; note('Edited entry "' + clean.intent_key + '" (' + p.M.name + ')'); }
      else { d.kb.push({ ...clean, id: Math.max(0, ...d.kb.map((e) => e.id)) + 1, dirty: true }); note('Added entry "' + clean.intent_key + '" (' + p.M.name + ')'); }
    });
    onClose(); const left = entryProblems(clean); p.toast(left.length ? 'Saved to draft, but the bot cannot use it yet: ' + left[0] : 'Saved to draft. Press Publish to make it live.');
  };
  const del = () => {
    p.edit((d, note) => { d.kb = d.kb.filter((e) => e.id !== ed.id); note('Deleted entry "' + ed.intent_key + '" (' + p.M.name + ')'); });
    onClose();
  };

  return (
    <Modal label="Edit entry" onClose={onClose}>
      <div className="head"><h2>{ed.id ? 'Edit entry' : 'New entry'}</h2><button className="btn sm" type="button" onClick={onClose}>Close</button></div>
      <div className="kbsec"><b>1</b> About this entry</div>
      <div className="form">
        <label className="fld"><span>Entry name</span><input type="text" value={ed.intent_key} onChange={(e) => set({ intent_key: e.target.value })} placeholder="e.g. daily_withdraw_limit" /></label>
        <label className="fld"><span>Status</span><select value={ed.status} onChange={(e) => set({ status: e.target.value as Entry['status'] })}><option value="live">Live</option><option value="draft">Draft (bot ignores it)</option></select></label>
        <label className="fld"><span>Type</span><select value={ed.entry_type || 'answer'} onChange={(e) => set({ entry_type: e.target.value as Entry['entry_type'] })}><option value="answer">Answer</option><option value="needs_staff">Needs staff</option><option value="promotion">Promotion</option></select></label>
        <label className="fld"><span>End date (optional)</span><input type="date" value={ed.ends_on || ''} onChange={(e) => set({ ends_on: e.target.value || null })} /></label>
        <div className="sub full" style={{ marginTop: -4 }}>{TYPE_NOTE[ed.entry_type || 'answer']}{ed.ends_on ? ' The entry is used until the end of ' + ed.ends_on + ', then it hides itself.' : ''}</div>
        <div className="kbsec full"><b>2</b> When the bot uses it</div>
        <label className="fld"><span>Topic (required)</span><select value={ed.topic} onChange={(e) => set({ topic: e.target.value })}><option value="">Choose a topic word…</option>{topicList(p.draft, p.merchant).map((x) => <option key={x}>{x}</option>)}<option value="__new">+ New topic…</option></select></label>
        {ed.topic === '__new' && <>
          <label className="fld"><span>Name of the new topic</span><input type="text" placeholder="e.g. refund" value={ed.newTopic} onChange={(e) => set({ newTopic: e.target.value })} /></label>
          <label className="fld full"><span>Keywords for it (comma separated, any language, optional)</span><input type="text" placeholder="e.g. refunds, bayaran balik, 退款" value={ed.newTopicW} onChange={(e) => set({ newTopicW: e.target.value })} /></label></>}
        <label className="tog full" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={ed.useAspect} onChange={(e) => set({ useAspect: e.target.checked })} style={{ marginTop: 3 }} /><span><b>Add a question type</b><br /><span className="sub">Tick this only if the topic has more than one entry, for example deposit: how to, how long, limit. The question type tells the bot which one the customer means.</span></span></label>
        {ed.useAspect && <>
          <label className="fld"><span>Question type</span><select value={ed.aspect || ''} onChange={(e) => set({ aspect: e.target.value || null })}><option value="">Choose a question type…</option>{Object.keys(p.draft.aspects).filter((x) => !['problem', 'help'].includes(x)).map((x) => <option key={x} value={x}>{ASPECT_LABEL[x] || x}</option>)}</select></label>
          {p.adv && <label className="tog full"><input type="checkbox" checked={ed.topic_optional} onChange={(e) => set({ topic_optional: e.target.checked })} /> The question type alone is enough (no topic word needed), for example opening hours</label>}</>}
      </div>
      <div className="note">The bot looks for the topic word anywhere in the customer's sentence and then gives this answer. If one topic has several entries, the customer is shown buttons to choose.</div>
      <div className="kbsec"><b>3</b> What the bot says, in each language</div>
      <div className="tabs" role="tablist">{LANGS.map((l) => { const s = langState(ed, l); return <button key={l} type="button" role="tab" aria-selected={l === ed.tab} onClick={() => set({ tab: l })}>{LN[l]} <span className={'dot ' + s}>{s === 'on' ? 'ok' : s === 'part' ? '!' : '—'}</span></button>; })}</div>
      <label className="fld"><span>Answer in {LN[ed.tab]} (facts only; the bot adds the tone)</span><textarea lang={ed.tab} value={t.answer_text} onChange={(e) => setTr({ answer_text: e.target.value })} /></label>
      <div className="tools" style={{ marginTop: -4 }}>
        {ed.tab === 'en'
          ? <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo(['ms', 'zh'])}>{busy ? 'Translating…' : 'Translate to Malay and Chinese'}</button>
          : <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo([ed.tab])}>{busy ? 'Translating…' : `Translate from English to ${LN[ed.tab]}`}</button>}
        {ed.tab === 'en' && <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo(['vi', 'th', 'tl'])}>{busy ? 'Translating…' : 'Translate to Vietnamese, Thai and Filipino'}</button>}
        <span className="sub">{p.ai.translate ? 'The AI writes a draft from the English answer and examples. Menu names stay as written. Please check it before saving.' : 'Translating needs the AI. Add the Anthropic key to .env.'}</span>
      </div>
      <div className="kbsec"><b>4</b> How customers ask for it</div>
      <div><h3>Example questions ({t.question_examples.length}) <span className={'pill ' + (t.question_examples.length >= 3 ? 'ok' : 'warn')}>{t.question_examples.length >= 3 ? 'enough' : 'add ' + (3 - t.question_examples.length) + ' more'}</span> <span className="sub">at least 3, include slang</span></h3>
        <div className="chips">{t.question_examples.map((x, i) => <span className="chip" key={i}>{x}<button type="button" aria-label="Remove" onClick={() => setTr({ question_examples: t.question_examples.filter((_, j) => j !== i) })}>×</button></span>)}{!t.question_examples.length && <span className="sub">None yet</span>}</div>
        <div className="addrow"><input type="text" placeholder="Add an example, then press Enter" style={{ flex: 1, minWidth: 180 }} value={ed.newEx} onChange={(e) => set({ newEx: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEx(); } }} /><button className="btn sm" type="button" onClick={addEx}>Add</button><button className="btn sm" type="button" onClick={suggest}>Suggest with AI</button></div></div>
      {sug.length > 0 && <div className="sug"><b style={{ fontSize: 12.5 }}>AI suggestions · need your approval</b>{sug.map((x, i) => (
        <div className="it" key={i}><span>{x}</span><span>
          <button className="btn sm" type="button" onClick={() => setEd({ ...ed, sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) }, translations: { ...ed.translations, [ed.tab]: { ...t, question_examples: [...t.question_examples, x] } } })}>Approve</button>{' '}
          <button className="btn sm" type="button" onClick={() => set({ sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) } })}>Dismiss</button></span></div>))}</div>}
      <div className="kbsec"><b>5</b> After the answer: ask for details (optional)</div>
      <div className="sub" style={{ marginTop: -4 }}>For a topic that needs more from the customer, for example a deposit that is not in: the bot gives the answer, asks up to 3 questions one by one, then passes the chat to a person with the details as a note. A picture of a receipt only works when LiveChat sends pictures to the bot (patch 002). The customer can type "skip" at any question. A language left empty uses the English question.</div>
      {(ed.steps ?? []).map((st, i) => (
        <div className="stepbox" key={i} aria-label={'Question ' + (i + 1)}>
          <div className="head"><b>Question {i + 1}</b><span className="tools">
            <label className="fld" style={{ margin: 0 }}><select aria-label={'Question ' + (i + 1) + ' asks for'} value={st.kind} onChange={(e) => set({ steps: (ed.steps ?? []).map((x, j) => (j === i ? { ...x, kind: e.target.value as typeof st.kind } : x)) })}>{STEP_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <button className="btn sm" type="button" aria-label={'Remove question ' + (i + 1)} onClick={() => set({ steps: (ed.steps ?? []).filter((_, j) => j !== i) })}>Remove</button></span></div>
          <div className="form">{STEP_LANGS.map((l) => <label className="fld" key={l}><span>{LN[l]}{l === 'en' ? ' (required)' : ' (optional)'}</span><input type="text" lang={l} aria-label={'Question ' + (i + 1) + ' in ' + LN[l]} value={st.ask?.[l] ?? ''} placeholder={l === 'en' ? (st.kind === 'receipt' ? 'e.g. Please send a picture of your receipt.' : st.kind === 'amount' ? 'e.g. How much did you deposit?' : 'Write the question') : ''} onChange={(e) => set({ steps: (ed.steps ?? []).map((x, j) => (j === i ? { ...x, ask: { ...x.ask, [l]: e.target.value } } : x)) })} /></label>)}</div>
        </div>))}
      <div><button className="btn sm" type="button" disabled={(ed.steps ?? []).length >= 3} onClick={() => set({ steps: [...(ed.steps ?? []), { kind: (ed.steps ?? []).length ? 'amount' : 'receipt', ask: { en: '' } }] })}>+ Add a question{(ed.steps ?? []).length >= 3 ? ' (the most is 3)' : ''}</button></div>
      {(() => { const pr = entryProblems(ed); return pr.length ? <div className="note" role="status" style={{ background: 'var(--warnbg)' }}><b>Before the bot can use this answer:</b><ul className="plain">{pr.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : <div className="note" role="status" style={{ background: 'var(--okbg)' }}>✓ Ready: Live, with an answer and example questions. Save it, then Publish.</div>; })()}
      <div className="head" style={{ marginTop: 'auto' }}><span className="sub">Saved as a draft change until you publish.</span><span className="tools">{ed.id ? <button className="btn sm bad" type="button" onClick={del}>Delete</button> : null}<button className="btn pri" type="button" onClick={save}>Save to draft</button></span></div>
    </Modal>
  );
}
