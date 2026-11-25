import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import KbGrid from './KbGrid';
import KbLanguages from './KbLanguages';
import TranslateAll, { useTranslateJobs } from './TranslateAll';
import { autoOn, needsTranslation, sourceLang, targetLangs, translateEntry } from '../autotr';
import { ASPECT_LABEL, CORE_LANGS, LANGS, LN, addOwnTopic, clone, entryProblems, langState, slug, topicList, topicNames, type Entry } from '../model';
import { Modal, Pill } from '../ui';
import { useT } from '../i18n';

type Tr = { question_examples: string[]; answer_text: string; ai?: boolean };
type Ed = Entry & { useAspect: boolean; tab: string; sug: Record<string, string[]>; newTopic: string; newTopicW: string; newEx: string };
const blank = (merchant: string): Entry => ({ id: 0, merchant, intent_key: '', topic: '', aspect: null, topic_optional: false, status: 'live', category: 'General', translations: {} });
const TYPE_NOTE: Record<string, string> = { answer: 'The bot answers with this text.', needs_staff: 'A person must answer this (for example the customer\'s own account). The bot hands the chat over instead of answering.', promotion: 'An answer that is only true for a while. Set an end date: after it the bot stops using this entry.' };
/** What a guided answer can ask the customer for after the answer. */
const STEP_KINDS: [string, string][] = [['receipt', 'A receipt picture'], ['amount', 'An amount'], ['username', 'The username'], ['phone', 'A phone number'], ['text', 'A short reply']];
const STEP_LANGS = ['en', 'ms', 'zh'] as const;
/** A problem text from entryProblems(), in the panel language. The one with a number is written out for both singular and plural. */
const tProblem = (t: (s: string, v?: Record<string, string | number>) => string, x: string) => {
  const m = x.match(/^Only (\d+) example questions?\. /);
  return m ? t(m[1] === '1' ? 'Only 1 example question. Add at least 3, with slang, so the bot finds it more often.' : 'Only {n} example questions. Add at least 3, with slang, so the bot finds it more often.', { n: m[1] }) : t(x);
};
const trOf = (e: Entry, l: string): Tr => (e.translations as Record<string, Tr>)[l] || { question_examples: [], answer_text: '' };

export default function Kb() {
  const p = usePanel(); const { t } = useT();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all'); const [topicF, setTopicF] = useState('all');
  const [ed, setEd] = useState<Ed | null>(null);
  const [view, setViewState] = useState<'list' | 'table'>(() => { try { return localStorage.getItem('kbView') === 'list' ? 'list' : 'table'; } catch { return 'table'; } });
  const setView = (v: 'list' | 'table') => { setViewState(v); try { localStorage.setItem('kbView', v); } catch { /* ignore */ } };
  const loc = useLocation(); const [tab, setTab] = useState<'entries' | 'languages'>(() => ((loc.state as { tab?: string } | null)?.tab === 'languages' ? 'languages' : 'entries')); const [trAll, setTrAll] = useState(false); const tj = useTranslateJobs();
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
  /** Turns entries live or off and publishes at once: the switch needs no Publish button. (Everything else waiting in the draft is published with it.) */
  const setStatusOf = async (ids: Set<number>, to: 'live' | 'draft') => {
    const chosen = all.filter((e) => ids.has(e.id) && e.status !== to); const n = chosen.length; if (!n) return p.toast(t('Nothing to change: they are already ' + to));
    p.edit((d, note) => { d.kb.forEach((e) => { if (ids.has(e.id) && e.merchant === p.merchant && e.status !== to) { e.status = to; e.dirty = true; } }); note(`Set ${n} entr${n === 1 ? 'y' : 'ies'} ${to} (${p.M.name})`); });
    setSel(new Set());
    try {
      await p.publishNow();
      p.toast(n === 1 ? t(to === 'live' ? 'Live now: “{k}”' : 'Switched off: “{k}”', { k: chosen[0].intent_key }) : t(to === 'live' ? 'Live now: {n} entries' : 'Switched off: {n} entries', { n }));
    } catch (e) { p.toast(t('Could not publish: {e}', { e: (e as Error).message })); }
  };
  const deleteSel = () => {
    if (!picked.length || !window.confirm(t(picked.length === 1 ? 'Delete 1 entry? You can still go back by not publishing, or from History.' : 'Delete {n} entries? You can still go back by not publishing, or from History.', { n: picked.length }))) return;
    const ids = new Set(picked.map((e) => e.id));
    p.edit((d, note) => { d.kb = d.kb.filter((e) => !(ids.has(e.id) && e.merchant === p.merchant)); note(`Deleted ${ids.size} entr${ids.size === 1 ? 'y' : 'ies'} (${p.M.name})`); });
    setSel(new Set());
  };

  const open = (e: Entry | null) => {
    const src = e ? clone(e) : blank(p.merchant);
    LANGS.forEach((l) => { (src.translations as Record<string, Tr>)[l] = trOf(src, l); });
    setEd({ ...src, useAspect: !!src.aspect, tab: sourceLang(p.M), sug: {}, newTopic: '', newTopicW: '', newEx: '' });
  };
  return (
    <>
      <div className="card"><div className="head"><div><h2>{t('Knowledge base')} · {p.M.name}</h2><div className="sub">{t('What the bot may answer for this merchant. Only live entries are used.')}</div></div>
        <span className="tools"><span className="segs viewsw" role="group" aria-label="View"><button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} title={t('Edit the answers and example questions in a table')}>{t('Table')}</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('List')}</button></span>
        {tj.count > 0 && <button className="btn" type="button" title={t(p.ai.translate ? 'Fill every empty language of every entry with the AI' : 'The AI is off. Add the Anthropic key to .env.')} onClick={() => setTrAll(true)}>{t('Translate all')} ({tj.count})</button>}
        <button className="btn pri" type="button" onClick={() => open(null)}>{t('Add entry')}</button></span></div>
        <div className="kbtabs"><div className="segs" role="group" aria-label={t('Knowledge base sections')}>{([['entries', 'Entries'], ['languages', 'Languages']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{t(l)}</button>)}</div></div>
        {tab === 'entries' && miss ? <div className="kwstats"><span className="st dim" title={t('Entries missing an answer or 3+ examples in a main language')}>{miss} {t('missing a language or examples')}</span></div> : null}
        {tab === 'entries' && <div className="filt-row" style={{ marginTop: 12 }}>
          <div className="segs" role="group" aria-label="Show">{([['all', t('All'), all.length], ['live', t('Live'), live], ['draft', t('Draft'), drafts], ['needs', t('Needs work'), needs]] as const).map(([k, l, n]) => <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l} <span className="n">{n}</span></button>)}</div>
          <input type="search" placeholder={t('Search entries or answers')} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
          <select aria-label="Topic" value={topicF} onChange={(e) => setTopicF(e.target.value)}><option value="all">{t('All topics')}</option>{topicsIn.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <span className="sub">{list.length} {t('shown')}</span>
          {readyDrafts.length > 0 && <button className="btn sm pri" type="button" title={t('Drafts that have an answer and at least 3 example questions. Entries that still say TO WRITE are left as drafts.')} onClick={() => setStatusOf(new Set(readyDrafts.map((e) => e.id)), 'live')}>{t(readyDrafts.length === 1 ? 'Set 1 ready draft live' : 'Set {n} ready drafts live', { n: readyDrafts.length })}</button>}</div>}</div>
      {tab === 'entries' && view === 'list' && picked.length > 0 && <div className="bulkbar" role="region" aria-label="Selected entries"><b>{picked.length} {t('selected')}</b>
        <button className="btn sm pri" type="button" onClick={() => setStatusOf(new Set(picked.map((e) => e.id)), 'live')}>{t('Set live')}</button>
        <button className="btn sm" type="button" onClick={() => setStatusOf(new Set(picked.map((e) => e.id)), 'draft')}>{t('Set draft')}</button>
        <button className="btn sm bad" type="button" onClick={deleteSel}>{t('Delete')}</button>
        <button className="btn sm ghost" type="button" onClick={() => setSel(new Set())}>{t('Clear')}</button></div>}
      {tab === 'languages' ? <KbLanguages onTranslateAll={() => setTrAll(true)} /> : view === 'table' ? <KbGrid list={list} onOpen={open} /> : <div className="card scroll"><table><thead><tr><th style={{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(list.map((e) => e.id)))} /></th><th>{t('Entry')}</th><th>{t('Topic')}{p.adv ? ' · ' + t('question') : ''}</th><th>{t('Languages')}</th><th>{t('Questions')}</th><th>{t('Answer (English)')}</th><th>{t('Status')}</th></tr></thead><tbody>
        {list.map((e) => (
          <tr className="row" key={e.id} onClick={() => open(e)}>
            <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" aria-label={'Select ' + e.intent_key} checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></td>
            <td><b>{e.intent_key}</b>{entryProblems(e).length ? <span className="pill warn" style={{ marginLeft: 8 }} title={entryProblems(e).map((x) => tProblem(t, x)).join(' ')}>{t('needs work')}</span> : null}</td>
            <td>{e.topic ? <Pill c="info">{e.topic}</Pill> : <Pill c="bad">{t('missing')}</Pill>}{p.adv && e.aspect ? <> <Pill>{e.aspect}{e.topic_optional ? ' ' + t('(alone)') : ''}</Pill></> : null}</td>
            <td><div className="dots">{LANGS.map((l) => { const s = langState(e, l); return <span key={l} className={'dot ' + s} title={`${LN[l]}: ${t(s === 'on' ? 'complete' : s === 'part' ? 'needs 3+ examples or an answer' : 'empty')}`}>{LN[l]}</span>; })}</div></td>
            <td className="num">{(() => { const n = trOf(e, 'en').question_examples.length; return <span className={'pill' + (n < 3 ? ' warn' : '')} title={t(n < 3 ? 'Add at least 3 example questions' : 'Example questions in English')}>{n}</span>; })()}</td>
            <td><div className="clamp2">{trOf(e, 'en').answer_text}</div></td>
            <td><div className="stcell"><label className={'switch kbsw ' + (e.status === 'live' ? 'on' : 'off')} onClick={(ev) => ev.stopPropagation()} title={t(e.status === 'live' ? 'Live: the bot uses this answer. Switch it off and the bot stops using it at once.' : 'Off: the bot ignores this answer. Switch it on and the bot uses it at once.')}><input type="checkbox" role="switch" aria-label={'Live ' + e.intent_key} checked={e.status === 'live'} onChange={() => void setStatusOf(new Set([e.id]), e.status === 'live' ? 'draft' : 'live')} /><span className="track"><span className="thumb" /></span><span className="kbswt">{t(e.status === 'live' ? 'Live' : 'Draft')}</span></label>{e.steps?.length ? <> <Pill c="info">{t('asks')} {e.steps.length}</Pill></> : null}{e.entry_type && e.entry_type !== 'answer' ? <> <Pill c="info">{t(e.entry_type === 'needs_staff' ? 'needs staff' : 'promotion')}</Pill></> : null}{e.ends_on ? <> <Pill c={e.ends_on < new Date().toISOString().slice(0, 10) ? 'bad' : 'info'}>{t(e.ends_on < new Date().toISOString().slice(0, 10) ? 'ended' : 'until')} {e.ends_on}</Pill></> : null}{(e as Entry).dirty ? <> <Pill c="info">{t('edited')}</Pill></> : null}</div></td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={7} className="sub">{t('No entries match.')}</td></tr>}
      </tbody></table></div>}
      {ed && <Editor ed={ed} setEd={setEd} onClose={() => setEd(null)} />}
      {trAll && <TranslateAll onClose={() => setTrAll(false)} />}
    </>
  );
}

function Editor({ ed, setEd, onClose }: { ed: Ed; setEd: (e: Ed) => void; onClose: () => void }) {
  const p = usePanel();
  const set = (patch: Partial<Ed>) => setEd({ ...ed, ...patch });
  const tx = trOf(ed, ed.tab); const { t } = useT();
  const setTr = (patch: Partial<Tr>, lang = ed.tab) => setEd({ ...ed, translations: { ...ed.translations, [lang]: { ...trOf(ed, lang), ...patch, ai: undefined } } });          // a person edits it: it is no longer an AI draft
  const sug = ed.sug[ed.tab] || [];
  const [saving, setSaving] = useState(false); const src = sourceLang(p.M);

  const addEx = () => { const v = ed.newEx.trim(); if (v) setEd({ ...ed, newEx: '', translations: { ...ed.translations, [ed.tab]: { ...tx, question_examples: [...tx.question_examples, v], ai: undefined } } }); };
  const [sBusy, setSBusy] = useState(false);
  /** The "Suggest with AI" button: the AI writes new example questions for this entry in the language of the open tab. They go to the list below, and nothing is added until a person approves. Without the AI it adds a few simple variations of the first example. */
  const suggest = async () => {
    if (p.ai.suggest) {
      const ans = tx.answer_text.trim() || trOf(ed, 'en').answer_text.trim();
      if (!ans) return p.toast(t('Write the answer first: the AI writes questions that this answer fits.'));
      setSBusy(true);
      try {
        const r = await api<{ questions: string[] }>('/api/admin/suggest-questions', { merchant: p.merchant, lang: ed.tab, intentKey: ed.intent_key, topic: ed.topic === '__new' ? ed.newTopic : ed.topic, answer: ans, examples: tx.question_examples, count: 6 });
        set({ sug: { ...ed.sug, [ed.tab]: r.questions } });
      } catch (e) { p.toast((e as Error).message); } finally { setSBusy(false); }
      return;
    }
    const base = tx.question_examples[0] || (ed.intent_key || 'question').replace(/_/g, ' ');
    const sfx = ({ en: ['pls', 'boss', 'ya'], ms: ['tolong', 'boss', 'lah'], zh: ['请问', '老板', '呀'], vi: ['nhé', 'shop', 'giúp mình'], th: ['ค่ะ', 'ครับ', 'หน่อย'], tl: ['po', 'boss', 'naman'] } as Record<string, string[]>)[ed.tab];
    const out = ed.tab === 'zh' ? [sfx[0] + base, base + sfx[2], sfx[1] + base] : [base + ' ' + sfx[0], sfx[1] + ' ' + base, base + ' ' + sfx[2]];
    set({ sug: { ...ed.sug, [ed.tab]: out } });
  };

  /** Saves the entry to the draft. With `thenPublish` the Publish window opens next (only when the entry saved), so changing one answer is: type, Save and publish. */
  const save = async () => {
    if (!ed.intent_key.trim()) return p.toast(t('Give the entry a name first'));
    if (!trOf(ed, src).answer_text.trim()) return p.toast(t('Add the answer first: it is the one the other languages are made from.'));
    let topic = ed.topic; let newTopic = '';
    if (topic === '__new') { newTopic = slug(ed.newTopic); if (!newTopic) return p.toast(t('Type a name for the new topic')); topic = newTopic; }
    if (!topic) return p.toast(t('Choose a topic first. It is required.'));
    if (ed.useAspect && !ed.aspect) return p.toast(t('Choose a question type, or untick "Add a question type".'));
    const { useAspect, tab, sug: _s, newTopic: _n, newTopicW, newEx: _e, ...rest } = ed; void tab;
    const steps = (ed.steps ?? []).map((x) => ({ kind: x.kind, ask: Object.fromEntries(Object.entries(x.ask ?? {}).map(([l, v]) => [l, (v ?? '').trim()]).filter(([, v]) => v)) as Record<string, string> })).filter((x) => x.ask.en || Object.keys(x.ask).length);
    if (steps.some((x) => !x.ask.en)) return p.toast(t('Write the English text of each question to the customer (section 5), or remove it'));
    let clean: Entry = { ...rest, steps: steps.length ? steps : undefined, intent_key: ed.intent_key.trim(), topic, aspect: useAspect ? ed.aspect : null, topic_optional: useAspect ? ed.topic_optional : false };
    let made: string[] = [], terr = '';
    if (autoOn(p.M) && p.ai.translate) {
      const langs = needsTranslation(clean, src, targetLangs(p.M), true);
      if (langs.length) { setSaving(true); const r = await translateEntry(p.merchant, clean, src, langs); setSaving(false); made = Object.keys(r.made); terr = r.error ?? ''; clean = { ...clean, translations: { ...clean.translations, ...r.made } as Entry['translations'] }; }
    }
    p.edit((d, note) => {
      if (newTopic && !topicNames(d, p.merchant).includes(newTopic)) {                 // a topic made here belongs to this merchant (the plan: each client owns its topic list)
        addOwnTopic(d, p.merchant, newTopic, newTopicW.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)); note('Added topic "' + newTopic + '" (' + p.M.name + ')');
      }
      if (ed.id) { const i = d.kb.findIndex((e) => e.id === ed.id); d.kb[i] = { ...d.kb[i], ...clean, dirty: true }; note('Edited entry "' + clean.intent_key + '" (' + p.M.name + ')'); if (made.length) note('Translated entry "' + clean.intent_key + '" into ' + made.map((l) => LN[l]).join(', ') + ' with AI (' + p.M.name + ')'); }
      else { d.kb.push({ ...clean, id: Math.max(0, ...d.kb.map((e) => e.id)) + 1, dirty: true }); note('Added entry "' + clean.intent_key + '" (' + p.M.name + ')'); if (made.length) note('Translated entry "' + clean.intent_key + '" into ' + made.map((l) => LN[l]).join(', ') + ' with AI (' + p.M.name + ')'); }
    });
    onClose();
    let published = true, perr = '';
    try { await p.publishNow(); } catch (e) { published = false; perr = (e as Error).message; }
    const left = entryProblems(clean);
    const tail = terr ? ' ' + t('Translation: ') + terr : made.length ? ' ' + t('Translated into {l} (AI draft). Please check it.', { l: made.map((l) => LN[l]).join(', ') }) : '';
    p.toast(!published ? t('Saved, but it could not be published: {e}', { e: perr }) : left.length ? t('Saved, but the bot cannot use it yet: ') + tProblem(t, left[0]) + tail : (clean.status === 'live' ? t('Saved and live.') : t('Saved as a draft: the bot ignores it.')) + tail);
  };
  const del = () => {
    p.edit((d, note) => { d.kb = d.kb.filter((e) => e.id !== ed.id); note('Deleted entry "' + ed.intent_key + '" (' + p.M.name + ')'); });
    onClose();
  };

  return (
    <Modal label={t('Edit entry')} onClose={onClose}>
      <div className="head"><h2>{t(ed.id ? 'Edit entry' : 'New entry')}</h2><button className="btn sm" type="button" onClick={onClose}>{t('Close')}</button></div>
      <div className="kbsec"><b>1</b> {t('About this entry')}</div>
      <div className="form">
        <label className="fld"><span>{t('Entry name')}</span><input type="text" value={ed.intent_key} onChange={(e) => set({ intent_key: e.target.value })} placeholder={t('e.g. daily_withdraw_limit')} /></label>
        <label className="fld"><span>{t('Status')}</span><select value={ed.status} onChange={(e) => set({ status: e.target.value as Entry['status'] })}><option value="live">{t('Live')}</option><option value="draft">{t('Draft (bot ignores it)')}</option></select></label>
        <label className="fld"><span>{t('Type')}</span><select value={ed.entry_type || 'answer'} onChange={(e) => set({ entry_type: e.target.value as Entry['entry_type'] })}><option value="answer">{t('Answer')}</option><option value="needs_staff">{t('Needs staff')}</option><option value="promotion">{t('Promotion')}</option></select></label>
        <label className="fld"><span>{t('End date (optional)')}</span><input type="date" value={ed.ends_on || ''} onChange={(e) => set({ ends_on: e.target.value || null })} /></label>
        <div className="sub full" style={{ marginTop: -4 }}>{t(TYPE_NOTE[ed.entry_type || 'answer'])}{ed.ends_on ? ' ' + t('The entry is used until the end of {d}, then it hides itself.', { d: ed.ends_on }) : ''}</div>
        <div className="kbsec full"><b>2</b> {t('When the bot uses it')}</div>
        <label className="fld"><span>{t('Topic (required)')}</span><select value={ed.topic} onChange={(e) => set({ topic: e.target.value })}><option value="">{t('Choose a topic word…')}</option>{topicList(p.draft, p.merchant).map((x) => <option key={x}>{x}</option>)}<option value="__new">{t('+ New topic…')}</option></select></label>
        {ed.topic === '__new' && <>
          <label className="fld"><span>{t('Name of the new topic')}</span><input type="text" placeholder={t('e.g. refund')} value={ed.newTopic} onChange={(e) => set({ newTopic: e.target.value })} /></label>
          <label className="fld full"><span>{t('Keywords for it (comma separated, any language, optional)')}</span><input type="text" placeholder="e.g. refunds, bayaran balik, 退款" value={ed.newTopicW} onChange={(e) => set({ newTopicW: e.target.value })} /></label></>}
        <label className="tog full" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={ed.useAspect} onChange={(e) => set({ useAspect: e.target.checked })} style={{ marginTop: 3 }} /><span><b>{t('Add a question type')}</b><br /><span className="sub">{t('Tick this if the topic has more than one entry (deposit: how to, how long, limit).')}</span></span></label>
        {ed.useAspect && <>
          <label className="fld"><span>{t('Question type')}</span><select value={ed.aspect || ''} onChange={(e) => set({ aspect: e.target.value || null })}><option value="">{t('Choose a question type…')}</option>{Object.keys(p.draft.aspects).filter((x) => !['problem', 'help'].includes(x)).map((x) => <option key={x} value={x}>{ASPECT_LABEL[x] ? t(ASPECT_LABEL[x]) : x}</option>)}</select></label>
          {p.adv && <label className="tog full"><input type="checkbox" checked={ed.topic_optional} onChange={(e) => set({ topic_optional: e.target.checked })} /> {t('The question type alone is enough (no topic word needed), for example opening hours')}</label>}</>}
      </div>
      <div className="kbsec"><b>3</b> {t('What the bot says, in each language')}</div>
      <div className="tabs" role="tablist">{[src, ...targetLangs(p.M)].concat(LANGS.filter((l) => l !== src && !targetLangs(p.M).includes(l) && (l === ed.tab || trOf(ed, l).answer_text.trim() || trOf(ed, l).question_examples.length))).map((l) => { const s = langState(ed, l); return <button key={l} type="button" role="tab" aria-selected={l === ed.tab} onClick={() => set({ tab: l })}>{LN[l]} <span className={'dot ' + s}>{s === 'on' ? 'ok' : s === 'part' ? '!' : '—'}</span></button>; })}</div>
      <label className="fld"><span>{t('Answer in {l} (facts only; the bot adds the tone)', { l: LN[ed.tab] })}</span><textarea lang={ed.tab} className={tx.ai ? 'ai-tr' : undefined} value={tx.answer_text} onChange={(e) => setTr({ answer_text: e.target.value })} /></label>
      <div className="sub" style={{ marginTop: -4 }}>{tx.ai ? <><span className="aibadge">{t('AI draft · check')}</span> {t('Written by the AI. Edit it and the mark goes away.')}</> : ed.tab === src ? (autoOn(p.M) && p.ai.translate ? t('Type here. When you save, the empty languages of this merchant are filled in by the AI.') : '') : ''}</div>
      <div className="kbsec"><b>4</b> {t('How customers ask for it')}</div>
      <div><h3>{t('Example questions')} ({tx.question_examples.length}) <span className={'pill ' + (tx.question_examples.length >= 3 ? 'ok' : 'warn')}>{tx.question_examples.length >= 3 ? t('enough') : t('add {n} more', { n: 3 - tx.question_examples.length })}</span> <span className="sub">{t('at least 3, include slang')}</span></h3>
        <div className="chips">{tx.question_examples.map((x, i) => <span className="chip" key={i}>{x}<button type="button" aria-label={t('Remove')} onClick={() => setTr({ question_examples: tx.question_examples.filter((_, j) => j !== i) })}>×</button></span>)}{!tx.question_examples.length && <span className="sub">{t('None yet')}</span>}</div>
        <div className="addrow"><input type="text" placeholder={t('Add an example, then press Enter')} style={{ flex: 1, minWidth: 180 }} value={ed.newEx} onChange={(e) => set({ newEx: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEx(); } }} /><button className="btn sm" type="button" onClick={addEx}>{t('Add')}</button><button className="btn sm" type="button" disabled={sBusy} title={p.ai.suggest ? t('The AI writes new example questions for this entry. You approve each one.') : t('The AI is off, so this only adds simple variations of the first example. Add the Anthropic key to .env for real suggestions.')} onClick={() => void suggest()}>{sBusy ? t('Thinking…') : t('Suggest with AI')}</button></div></div>
      {sug.length > 0 && <div className="sug"><b style={{ fontSize: 12.5 }}>{t('AI suggestions · need your approval')}</b> <button className="btn sm" type="button" onClick={() => setEd({ ...ed, sug: { ...ed.sug, [ed.tab]: [] }, translations: { ...ed.translations, [ed.tab]: { ...tx, question_examples: [...tx.question_examples, ...sug.filter((x) => !tx.question_examples.some((e) => e.toLowerCase() === x.toLowerCase()))] } } })}>{t('Approve all')}</button>{sug.map((x, i) => (
        <div className="it" key={i}><span>{x}</span><span>
          <button className="btn sm" type="button" onClick={() => setEd({ ...ed, sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) }, translations: { ...ed.translations, [ed.tab]: { ...tx, question_examples: [...tx.question_examples, x] } } })}>{t('Approve')}</button>{' '}
          <button className="btn sm" type="button" onClick={() => set({ sug: { ...ed.sug, [ed.tab]: sug.filter((_, j) => j !== i) } })}>{t('Dismiss')}</button></span></div>))}</div>}
      <details className="kbmore" open={(ed.steps ?? []).length > 0}><summary>{t('Optional: ask the customer for details after the answer')}</summary>
      <div className="sub">{t('The bot gives the answer, asks up to 3 questions one by one, then passes the chat to a person with the details as a note.')}</div>
      {(ed.steps ?? []).map((st, i) => (
        <div className="stepbox" key={i} aria-label={t('Question {n}', { n: i + 1 })}>
          <div className="head"><b>{t('Question {n}', { n: i + 1 })}</b><span className="tools">
            <label className="fld" style={{ margin: 0 }}><select aria-label={t('Question {n} asks for', { n: i + 1 })} value={st.kind} onChange={(e) => set({ steps: (ed.steps ?? []).map((x, j) => (j === i ? { ...x, kind: e.target.value as typeof st.kind } : x)) })}>{STEP_KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
            <button className="btn sm" type="button" aria-label={t('Remove question {n}', { n: i + 1 })} onClick={() => set({ steps: (ed.steps ?? []).filter((_, j) => j !== i) })}>{t('Remove')}</button></span></div>
          <div className="form">{STEP_LANGS.map((l) => <label className="fld" key={l}><span>{LN[l]} {t(l === 'en' ? '(required)' : '(optional)')}</span><input type="text" lang={l} aria-label={t('Question {n} in {l}', { n: i + 1, l: LN[l] })} value={st.ask?.[l] ?? ''} placeholder={l === 'en' ? t(st.kind === 'receipt' ? 'e.g. Please send a picture of your receipt.' : st.kind === 'amount' ? 'e.g. How much did you deposit?' : 'Write the question') : ''} onChange={(e) => set({ steps: (ed.steps ?? []).map((x, j) => (j === i ? { ...x, ask: { ...x.ask, [l]: e.target.value } } : x)) })} /></label>)}</div>
        </div>))}
      <div><button className="btn sm" type="button" disabled={(ed.steps ?? []).length >= 3} onClick={() => set({ steps: [...(ed.steps ?? []), { kind: (ed.steps ?? []).length ? 'amount' : 'receipt', ask: { en: '' } }] })}>{t('+ Add a question')}{(ed.steps ?? []).length >= 3 ? ' ' + t('(the most is 3)') : ''}</button></div>
      </details>
      {(() => { const pr = entryProblems(ed); return pr.length ? <div className="note" role="status" style={{ background: 'var(--warnbg)' }}><b>{t('Before the bot can use this answer:')}</b><ul className="plain">{pr.map((x, i) => <li key={i}>{tProblem(t, x)}</li>)}</ul></div> : <div className="note" role="status" style={{ background: 'var(--okbg)' }}>{t('✓ Ready: Live, with an answer and example questions. Save it, then Publish.')}</div>; })()}
      <div className="head" style={{ marginTop: 'auto' }}><span className="sub">{t('Saving makes the change live for customers.')}</span><span className="tools">{ed.id ? <button className="btn sm bad" type="button" onClick={del}>{t('Delete')}</button> : null}<button className="btn pri" type="button" disabled={saving} onClick={() => void save()}>{t(saving ? 'Translating…' : 'Save')}</button></span></div>
    </Modal>
  );
}
