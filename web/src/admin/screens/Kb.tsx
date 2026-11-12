import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { ASPECT_LABEL, CORE_LANGS, LANGS, LN, clone, langState, slug, topicList, guessLang, emptyWords, type Entry } from '../model';
import { Modal, Pill } from '../ui';

type Tr = { question_examples: string[]; answer_text: string };
type Ed = Entry & { useAspect: boolean; tab: string; sug: Record<string, string[]>; newTopic: string; newTopicW: string; newEx: string };
const blank = (merchant: string): Entry => ({ id: 0, merchant, intent_key: '', topic: '', aspect: null, topic_optional: false, status: 'draft', category: 'General', translations: {} });
const trOf = (e: Entry, l: string): Tr => (e.translations as Record<string, Tr>)[l] || { question_examples: [], answer_text: '' };

export default function Kb() {
  const p = usePanel();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all');
  const [ed, setEd] = useState<Ed | null>(null);
  const loc = useLocation(); const nav = useNavigate(); const resolveAfter = useRef<string | null>(null);
  const all = p.draft.kb.filter((e) => e.merchant === p.merchant);
  const list = all.filter((e) => (status === 'all' || e.status === status) && (!q || (e.intent_key + ' ' + LANGS.map((l) => trOf(e, l).answer_text).join(' ')).toLowerCase().includes(q.toLowerCase())));
  const live = all.filter((e) => e.status === 'live').length, miss = all.filter((e) => CORE_LANGS.some((l) => langState(e, l) !== 'on')).length;

  const open = (e: Entry | null, prefill?: { lang: string; text: string }) => {
    const src = e ? clone(e) : blank(p.merchant);
    LANGS.forEach((l) => { (src.translations as Record<string, Tr>)[l] = trOf(src, l); });
    if (prefill) (src.translations as Record<string, Tr>)[prefill.lang].question_examples.push(prefill.text);
    setEd({ ...src, useAspect: !!src.aspect, tab: prefill?.lang ?? 'en', sug: {}, newTopic: '', newTopicW: '', newEx: '' });
  };
  // coming from "Not understood" with "New answer": the editor opens with that message as the first example
  useEffect(() => {
    const pre = (loc.state as { prefill?: { lang: string; text: string } } | null)?.prefill;
    if (pre) { resolveAfter.current = pre.text; open(null, pre); nav(loc.pathname, { replace: true, state: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="card"><div className="head"><div><h2>Knowledge base · {p.M.name}</h2><div className="sub">What the bot may answer for this merchant. Only live entries are used.</div></div>
        <button className="btn pri" type="button" onClick={() => open(null)}>Add entry</button></div>
        <div className="quiet"><b>{live}</b> live{all.length - live ? <> · <b>{all.length - live}</b> draft</> : null}{miss ? <> · <b>{miss}</b> missing a language or examples</> : null}</div>
        <div className="filt-row" style={{ marginTop: 10 }}>
          <input type="search" placeholder="Search entries or answers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option><option value="live">Live</option><option value="draft">Draft</option></select></div></div>
      <div className="card scroll"><table><thead><tr><th>Entry</th><th>Topic{p.adv ? ' · question' : ''}</th><th>Languages</th><th>Answer (English)</th><th>Status</th></tr></thead><tbody>
        {list.map((e) => (
          <tr className="row" key={e.id} onClick={() => open(e)}>
            <td><b>{e.intent_key}</b></td>
            <td>{e.topic ? <Pill c="info">{e.topic}</Pill> : <Pill c="bad">missing</Pill>}{p.adv && e.aspect ? <> <Pill>{e.aspect}{e.topic_optional ? ' (alone)' : ''}</Pill></> : null}</td>
            <td><div className="dots">{LANGS.map((l) => { const s = langState(e, l); return <span key={l} className={'dot ' + s} title={`${LN[l]}: ${s === 'on' ? 'complete' : s === 'part' ? 'needs 3+ examples or an answer' : 'empty'}`}>{LN[l]}</span>; })}</div></td>
            <td>{trOf(e, 'en').answer_text.slice(0, 110)}</td>
            <td><Pill c={e.status === 'live' ? 'ok' : 'warn'}>{e.status}</Pill>{(e as Entry).dirty ? <> <Pill c="info">edited</Pill></> : null}</td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={5} className="sub">No entries match.</td></tr>}
      </tbody></table></div>
      {ed && <Editor ed={ed} setEd={setEd} onClose={() => { setEd(null); resolveAfter.current = null; }} onSaved={() => { const t = resolveAfter.current; resolveAfter.current = null; if (t) void p.resolveUnmatched([t], 'added').catch(() => undefined); }} />}
    </>
  );
}

function Editor({ ed, setEd, onClose, onSaved }: { ed: Ed; setEd: (e: Ed) => void; onClose: () => void; onSaved?: () => void }) {
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
        const r = await api<{ answer: string; examples: string[] }>('/api/admin/translate', { merchant: p.merchant, from: 'en', to: l, answer: en.answer_text, examples: en.question_examples });
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
    const clean: Entry = { ...rest, intent_key: ed.intent_key.trim(), topic, aspect: useAspect ? ed.aspect : null, topic_optional: useAspect ? ed.topic_optional : false };
    p.edit((d, note) => {
      if (newTopic && !d.aliases[newTopic]) {
        const byl: Record<string, string[]> = { ...emptyWords(), en: [newTopic] };
        newTopicW.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).forEach((w) => { const l = guessLang(w); if (!byl[l].includes(w)) byl[l].push(w); });
        d.aliases[newTopic] = byl; note('Added topic "' + newTopic + '"');
      }
      if (ed.id) { const i = d.kb.findIndex((e) => e.id === ed.id); d.kb[i] = { ...d.kb[i], ...clean, dirty: true }; note('Edited entry "' + clean.intent_key + '" (' + p.M.name + ')'); }
      else { d.kb.push({ ...clean, id: Math.max(0, ...d.kb.map((e) => e.id)) + 1, dirty: true }); note('Added entry "' + clean.intent_key + '" (' + p.M.name + ')'); }
    });
    onSaved?.(); onClose(); p.toast('Saved to draft');
  };
  const del = () => {
    p.edit((d, note) => { d.kb = d.kb.filter((e) => e.id !== ed.id); note('Deleted entry "' + ed.intent_key + '" (' + p.M.name + ')'); });
    onClose();
  };

  return (
    <Modal label="Edit entry" onClose={onClose}>
      <div className="head"><h2>{ed.id ? 'Edit entry' : 'New entry'}</h2><button className="btn sm" type="button" onClick={onClose}>Close</button></div>
      <div className="form">
        <label className="fld"><span>Entry name</span><input type="text" value={ed.intent_key} onChange={(e) => set({ intent_key: e.target.value })} placeholder="e.g. daily_withdraw_limit" /></label>
        <label className="fld"><span>Status</span><select value={ed.status} onChange={(e) => set({ status: e.target.value as Entry['status'] })}><option value="live">Live</option><option value="draft">Draft (bot ignores it)</option></select></label>
        <label className="fld"><span>Topic (required)</span><select value={ed.topic} onChange={(e) => set({ topic: e.target.value })}><option value="">Choose a topic word…</option>{topicList(p.draft).map((x) => <option key={x}>{x}</option>)}<option value="__new">+ New topic…</option></select></label>
        {ed.topic === '__new' && <>
          <label className="fld"><span>Name of the new topic</span><input type="text" placeholder="e.g. refund" value={ed.newTopic} onChange={(e) => set({ newTopic: e.target.value })} /></label>
          <label className="fld full"><span>Keywords for it (comma separated, any language, optional)</span><input type="text" placeholder="e.g. refunds, bayaran balik, 退款" value={ed.newTopicW} onChange={(e) => set({ newTopicW: e.target.value })} /></label></>}
        <label className="tog full" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={ed.useAspect} onChange={(e) => set({ useAspect: e.target.checked })} style={{ marginTop: 3 }} /><span><b>Add a question type</b><br /><span className="sub">Tick this only if the topic has more than one entry, for example deposit: how to, how long, limit. The question type tells the bot which one the customer means.</span></span></label>
        {ed.useAspect && <>
          <label className="fld"><span>Question type</span><select value={ed.aspect || ''} onChange={(e) => set({ aspect: e.target.value || null })}><option value="">Choose a question type…</option>{Object.keys(p.draft.aspects).filter((x) => !['problem', 'help'].includes(x)).map((x) => <option key={x} value={x}>{ASPECT_LABEL[x] || x}</option>)}</select></label>
          {p.adv && <label className="tog full"><input type="checkbox" checked={ed.topic_optional} onChange={(e) => set({ topic_optional: e.target.checked })} /> The question type alone is enough (no topic word needed), for example opening hours</label>}</>}
      </div>
      <div className="note">The bot looks for the topic word anywhere in the customer's sentence and then gives this answer. If one topic has several entries, the customer is shown buttons to choose.</div>
      <div className="tabs" role="tablist">{LANGS.map((l) => { const s = langState(ed, l); return <button key={l} type="button" role="tab" aria-selected={l === ed.tab} onClick={() => set({ tab: l })}>{LN[l]} <span className={'dot ' + s}>{s === 'on' ? 'ok' : s === 'part' ? '!' : '—'}</span></button>; })}</div>
      <label className="fld"><span>Answer in {LN[ed.tab]} (facts only; the bot adds the tone)</span><textarea lang={ed.tab} value={t.answer_text} onChange={(e) => setTr({ answer_text: e.target.value })} /></label>
      <div className="tools" style={{ marginTop: -4 }}>
        {ed.tab === 'en'
          ? <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo(['ms', 'zh'])}>{busy ? 'Translating…' : 'Translate to Malay and Chinese'}</button>
          : <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo([ed.tab])}>{busy ? 'Translating…' : `Translate from English to ${LN[ed.tab]}`}</button>}
        {ed.tab === 'en' && <button className="btn sm" type="button" disabled={busy || !p.ai.translate} title={p.ai.translate ? '' : 'The AI is off. Add the Anthropic key to .env.'} onClick={() => translateTo(['vi', 'th', 'tl'])}>{busy ? 'Translating…' : 'Translate to Vietnamese, Thai and Filipino'}</button>}
        <span className="sub">{p.ai.translate ? 'The AI writes a draft from the English answer and examples. Menu names stay as written. Please check it before saving.' : 'Translating needs the AI. Add the Anthropic key to .env.'}</span>
      </div>
      <div><h3>Example questions ({t.question_examples.length}) <span className="sub">at least 3, include slang</span></h3>
        <div className="chips">{t.question_examples.map((x, i) => <span className="chip" key={i}>{x}<button type="button" aria-label="Remove" onClick={() => setTr({ question_examples: t.question_examples.filter((_, j) => j !== i) })}>×</button></span>)}{!t.question_examples.length && <span className="sub">None yet</span>}</div>
        <div className="addrow"><input type="text" placeholder="Add an example, then press Enter" style={{ flex: 1, minWidth: 180 }} value={ed.newEx} onChange={(e) => set({ newEx: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEx(); } }} /><button className="btn sm" type="button" onClick={addEx}>Add</button><button className="btn sm" type="button" onClick={suggest}>Suggest with AI</button></div></div>
      {sug.length > 0 && <div className="sug"><b style={{ fontSize: 12.5 }}>AI suggestions · need your approval</b>{sug.map((x, i) => (
        <div className="it" key={i}><span>{x}</span><span>
          <button className="btn sm" type="button" onClick={() => setEd({ ...ed, sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) }, translations: { ...ed.translations, [ed.tab]: { ...t, question_examples: [...t.question_examples, x] } } })}>Approve</button>{' '}
          <button className="btn sm" type="button" onClick={() => set({ sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) } })}>Dismiss</button></span></div>))}</div>}
      <div className="head" style={{ marginTop: 'auto' }}><span className="sub">Saved as a draft change until you publish.</span><span className="tools">{ed.id ? <button className="btn sm bad" type="button" onClick={del}>Delete</button> : null}<button className="btn pri" type="button" onClick={save}>Save to draft</button></span></div>
    </Modal>
  );
}
