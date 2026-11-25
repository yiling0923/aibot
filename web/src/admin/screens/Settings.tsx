import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { LANGS, LANG_NAMES, LN, clone } from '../model';
import { useT } from '../i18n';

const TN: Record<string, string> = { deposit_status: 'Deposit status', withdraw_status: 'Withdrawal status', balance: 'Balance', transactions: 'Recent transactions', points: 'Points and level' };
const FN: Record<string, string> = { deposit_status: 'get_recent_deposits', withdraw_status: 'get_recent_withdrawals', balance: 'get_balance', transactions: 'get_recent_transactions', points: 'get_points' };

interface Basics { currency: string; retentionDays: number; name: string; domain: string; defaultLanguage: string; languages: string[]; monthlyTokenLimit: number | null; tokensMonth: number; tokensToday: number; entries: number; questionsToday: number; avgConfidence: number | null }
const PRESETS: [string, string][] = [
  ['Formal tone', 'Always use formal, professional language.'], ['Warm and friendly', 'Use a warm, friendly and casual tone.'],
  ['Address as “Dear Member”', 'Address the customer as "Dear Member".'], ['Max 2 sentences', 'Keep every translation or reworded reply to 2 sentences at most.'],
  ['Simple everyday words', 'Use simple everyday words, avoid jargon.'], ['Never use emoji', 'Never use emoji.'],
];
const MAX_INSTRUCTIONS = 5000;
const LNAME: Record<string, string> = Object.fromEntries(LANG_NAMES);

export default function Settings() {
  const p = usePanel();
  return <Form key={p.merchant} />;
}

/** One setting as a row: the words on the left, a switch on the right. A locked row is on and cannot be changed. */
function SRow({ title, sub, tag, checked, onChange, disabled }: { title: string; sub: React.ReactNode; tag?: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  const { t: T } = useT(); title = T(title); if (typeof sub === 'string') sub = T(sub);
  return (
    <div className={'srow' + (disabled && tag === 'not available yet' ? ' dim' : '')}><div><b>{title}</b>{tag && <span className="stag">{T(tag)}</span>}<div className="sub">{sub}</div></div>
      <label className="switch"><input type="checkbox" role="switch" aria-label={title} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} /><span className="track"><span className="thumb" /></span></label></div>
  );
}

function Form() {
  const p = usePanel(); const { t: T } = useT(); const lock = !p.isAdmin; const nav = useNavigate();
  const [s, setS] = useState(() => clone(p.draft.settings[p.merchant]));
  const [lang, setLang] = useState('en');
  const [tab, setTabState] = useState(() => { try { return localStorage.getItem('settingsTab') || 'general'; } catch { return 'general'; } });
  const setTab = (t: string) => { setTabState(t); try { localStorage.setItem('settingsTab', t); } catch { /* ignore */ } };
  const base = useRef(clone(p.draft.settings[p.merchant]));        // what the draft held when the page opened or was last saved
  const [b, setB] = useState<Basics | null>(null); const [f, setF] = useState({ name: '', domain: '', limit: '', retention: '', currency: 'RM', languages: new Set<string>() }); const [busy, setBusy] = useState(false);
  const loadBasics = useCallback(async () => {
    try { const x = await api<Basics>(`/api/admin/merchants/${encodeURIComponent(p.merchant)}/basics`); setB(x); setF({ name: x.name, domain: x.domain, limit: x.monthlyTokenLimit === null ? '' : String(x.monthlyTokenLimit), retention: x.retentionDays ? String(x.retentionDays) : '', currency: x.currency || 'RM', languages: new Set(x.languages) }); } catch { setB(null); }
  }, [p.merchant]);
  useEffect(() => { void loadBasics(); }, [loadBasics]);
  const saveBasics = async (quiet = false): Promise<boolean> => {
    setBusy(true);
    try {
      await api(`/api/admin/merchants/${encodeURIComponent(p.merchant)}/basics`, { name: f.name, domain: f.domain, monthlyTokenLimit: f.limit.trim() === '' ? null : Number(f.limit), retentionDays: f.retention.trim() === '' ? 0 : Number(f.retention), currency: f.currency.trim(), languages: [...f.languages] });
      await api(`/api/admin/merchants/${encodeURIComponent(p.merchant)}/basics`, { name: f.name, domain: f.domain, monthlyTokenLimit: f.limit.trim() === '' ? null : Number(f.limit), retentionDays: f.retention.trim() === '' ? 0 : Number(f.retention), currency: f.currency.trim(), languages: [...f.languages] });
      return true;
    } catch (e) { p.toast((e as Error).message); return false; } finally { setBusy(false); }
  };
  const addPreset = (line: string) => { const cur = s.ai_instructions ?? ''; if (cur.includes(line)) return; const next = (cur.trim() ? cur.replace(/\s+$/, '') + '\n' : '') + '- ' + line; if (next.length <= MAX_INSTRUCTIONS) up({ ai_instructions: next }); };
  const up = (patch: Partial<typeof s>) => setS({ ...s, ...patch });
  const msg = (k: 'kind' | 'closing' | 'handoff' | 'more_help', v: string) => up({ [k]: { ...s[k], [lang]: v } });
  const save = (withBasics = false) => {
    p.edit((d, note) => {
      const t = d.settings[p.merchant]; t.ai_instructions = (s.ai_instructions ?? '').slice(0, MAX_INSTRUCTIONS); t.trigger_phrases = s.trigger_phrases ?? ''; t.tone = s.tone; t.kind = s.kind; t.closing = s.closing; t.handoff = s.handoff; t.more_help = s.more_help; t.more_help_on = s.more_help_on;
      if (p.isAdmin) { t.handoff_complaint = s.handoff_complaint !== false; t.handoff_account = s.handoff_account !== false; t.handoff_group = s.handoff_group; t.answer = s.answer; t.clarify = s.clarify; t.tools = s.tools; t.abuse_close_after = Math.max(0, Math.min(10, +s.abuse_close_after || 0)); t.reask_times = Math.max(0, Math.min(3, Math.round(Number(s.reask_times ?? 1)))); t.max_choices = Math.max(1, Math.min(5, Math.round(+s.max_choices || 3))); }
      note('Changed settings for ' + p.M.name);
    });
    base.current = clone(s); p.toast(T(withBasics ? 'Saved. Press Publish to make it live.' : 'Saved to draft'));
  };
  /** One button for the whole page: the basics (saved at once) and the settings (saved to the draft). With `thenPublish` the Publish window opens next, so a change is two clicks: change, Save and publish. */
  const saveAll = async (thenPublish = false) => {
    let withBasics = false;
    if (!lock && basicsDirty) { if (!(await saveBasics(true))) return; withBasics = true; }
    save(withBasics);
    if (thenPublish) nav('/admin/set', { state: { publish: true } });
  };
  /** The groups of settings that differ from the draft, by name, for the unsaved-changes bar. */
  const LABEL: Record<string, string> = { tone: 'Tone', answer: 'Match levels', clarify: 'Match levels', ai_instructions: 'Bot instructions', handoff_complaint: 'Complaint or dispute', handoff_account: 'Account details', trigger_phrases: 'Trigger phrases', tools: 'Account tools', max_choices: 'Choices', reask_times: 'Ask again', more_help_on: 'Line after choices', abuse_close_after: 'Rude messages', kind: 'Messages', closing: 'Messages', handoff: 'Messages', more_help: 'Messages', handoff_group: 'Human group' };
  const changed0 = [...new Set((Object.keys(s) as (keyof typeof s)[]).filter((k) => JSON.stringify(s[k] ?? null) !== JSON.stringify(base.current[k] ?? null)).map((k) => LABEL[k as string] ?? String(k)))].map((x) => T(x));
  const changed = basicsDirty0() ? [...changed0, T('Basics')] : changed0;
  const discard = () => { setS(clone(base.current)); if (b) setF({ name: b.name, domain: b.domain, limit: b.monthlyTokenLimit === null ? '' : String(b.monthlyTokenLimit), retention: b.retentionDays ? String(b.retentionDays) : '', currency: b.currency || 'RM', languages: new Set(b.languages) }); p.toast(T('Changes discarded')); };
  const basicsDirty = basicsDirty0();
  function basicsDirty0() { return !!b && (f.name !== b.name || f.domain !== b.domain || f.limit !== (b.monthlyTokenLimit === null ? '' : String(b.monthlyTokenLimit)) || f.retention !== (b.retentionDays ? String(b.retentionDays) : '') || f.currency !== (b.currency || 'RM') || [...f.languages].sort().join() !== [...b.languages].sort().join()); }
  const TABS: [string, string][] = [['general', T('General')], ['replies', T('Replies')], ['handoff', T('Handoff')], ['ai', T('AI help')], ['messages', T('Messages')]];
  const cur = TABS.some(([k]) => k === tab) ? tab : 'general';
  return (
    <>
      <div className="head"><div><h2 style={{ margin: 0 }}>{T('Merchant settings')} · {p.M.name}</h2><div className="sub">{T('How the bot behaves for this merchant. The instructions and replies go to the draft, then Publish. The basics are saved at once.')}</div></div><span className="tools"><button className="btn" type="button" onClick={() => void saveAll(false)}>{T('Save to draft')}</button><button className="btn pri" type="button" onClick={() => void saveAll(true)}>{T('Save and publish')}</button></span></div>
      {b && <div className="btiles"><div className="rptile"><i style={{ background: '#7fa8e8' }} /><small>{T('Answers (knowledge base)')}</small><b>{b.entries}</b></div><div className="rptile"><i style={{ background: '#7fc4a8' }} /><small>{T('Questions today')}</small><b>{b.questionsToday}</b></div>
        <div className="rptile"><i style={{ background: '#9b8bd8' }} /><small>{T('AI tokens today')}</small><b>{b.tokensToday.toLocaleString()}</b></div><div className="rptile"><i style={{ background: '#f0c27b' }} /><small>{T('Average confidence')}</small><b>{b.avgConfidence === null ? '—' : Math.round(b.avgConfidence * 100) + '%'}</b></div></div>}
      <div className="tabs" role="tablist" style={{ margin: '6px 0 14px' }}>{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={k === cur} onClick={() => setTab(k)}>{l}</button>)}</div>
      {cur === 'general' && (b ? <>
      <div className="card"><div className="head"><h3 style={{ margin: 0 }}>{T('Basics')}</h3><span className="lock">{lock ? T('Only an admin can change these') : T('Saved together with the other settings: use Save at the top.')}</span></div>
        <div className="form" style={{ marginTop: 10 }}>
          <label className="fld"><span>{T('Name')}</span><input value={f.name} disabled={lock} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="fld"><span>{T('Domain (optional)')}</span><input value={f.domain} placeholder="merchant-domain.com" disabled={lock} onChange={(e) => setF({ ...f, domain: e.target.value })} /></label>
          <div><label className="fld"><span>{T('Monthly AI token limit (empty = unlimited)')}</span><input type="number" min={0} value={f.limit} placeholder={T('e.g. 500000')} disabled={lock} onChange={(e) => setF({ ...f, limit: e.target.value })} /></label>
            <div className="sub" style={{ marginTop: 4 }}>{T('Used this month: {n}. When the limit is reached the bot keeps answering from the knowledge base; only the AI help stops until next month.', { n: b.tokensMonth.toLocaleString() })}</div></div>
          <label className="fld"><span>{T('Money sign in bot messages')}</span><input value={f.currency} maxLength={8} placeholder="RM" disabled={lock} onChange={(e) => setF({ ...f, currency: e.target.value })} /><span className="lock">{T('For example RM, SGD, $ or ฿. It appears in "RM500 is within the limits".')}</span></label>
          <div><label className="fld"><span>{T('Keep conversations for (days)')}</span><input type="number" min={0} max={3650} value={f.retention} placeholder="0" disabled={lock} onChange={(e) => setF({ ...f, retention: e.target.value })} /></label>
            <div className="sub" style={{ marginTop: 4 }}>{T('Chats older than this are deleted every day. Empty or 0 keeps them for ever. The Report only counts chats that are kept. The keyword counts are not changed.')}</div></div>
          <div className="full"><div className="fld"><span>{T('Languages the bot answers in')}</span></div>
            <div className="segs" role="group" aria-label={T('Languages')}>{LANGS.map((l) => <button key={l} type="button" aria-pressed={f.languages.has(l)} disabled={lock || l === b.defaultLanguage} title={l === b.defaultLanguage ? T('The main language stays on') : ''}
              onClick={() => setF((x) => { const n = new Set(x.languages); if (n.has(l)) n.delete(l); else n.add(l); return { ...x, languages: n }; })}>{T(LNAME[l] ?? l)}</button>)}</div>
            <div className="sub" style={{ marginTop: 4 }}>{T("A customer writing in a language that is switched off gets this merchant's main language ({l}).", { l: T(LNAME[b.defaultLanguage] ?? b.defaultLanguage) })}</div></div>
        </div></div>
      </> : <div className="card sub">{T('The basics could not be loaded.')}</div>)}
      {cur === 'replies' && <>
      <div className="card"><h3 style={{ margin: 0 }}>{T('Replies and matching')}</h3>
        <div className="form" style={{ marginTop: 12 }}>
          <label className="fld"><span>{T('Tone of replies')}</span><select value={s.tone} onChange={(e) => up({ tone: e.target.value as 'friendly' | 'formal' })}><option value="friendly">{T('Friendly')}</option><option value="formal">{T('Formal')}</option></select></label>
          <div className="full"><div className="fld"><span>{T('Answer when the match is at least {n}', { n: s.answer.toFixed(2) })}</span></div><div className="slider"><span className="sub">{T('looser')}</span><input type="range" min="0.5" max="0.95" step="0.01" value={s.answer} disabled={lock} onChange={(e) => up({ answer: +e.target.value })} /><span className="sub">{T('stricter')}</span></div></div>
          <div className="full"><div className="fld"><span>{T('Ask with buttons when the match is at least {n}', { n: s.clarify.toFixed(2) })}</span></div><div className="slider"><span className="sub">{T('looser')}</span><input type="range" min="0.2" max="0.7" step="0.01" value={s.clarify} disabled={lock} onChange={(e) => up({ clarify: +e.target.value })} /><span className="sub">{T('stricter')}</span></div></div>
        </div></div>
      <div className="card"><h3>{T('Choices the bot offers')}</h3><div className="sub">{T('When the bot is not sure, it offers a few choices. Keep them short so the customer is not lost. "Talk to an agent" is always added and is not counted.')}</div>
        <div className="form" style={{ marginTop: 8 }}>
          <label className="fld"><span>{T('Most choices shown at once')} {lock ? T('(admin only)') : ''}</span><select value={s.max_choices} disabled={lock} onChange={(e) => up({ max_choices: +e.target.value })}><option value={1}>1</option><option value={2}>2</option><option value={3}>{T('3 (recommended)')}</option><option value={4}>4</option><option value={5}>5</option></select></label>
          <div className="full"><SRow title={'Add a line after the choices'} sub={'Such as “If you need other help, you can contact an agent.” Reword it per language under Fixed messages.'} checked={s.more_help_on} onChange={(v) => up({ more_help_on: v })} /></div>
        </div></div>
      <div className="card"><h3>{T('When the bot does not understand')}</h3><div className="sub">{T('If a message has no topic or question word the bot knows, it asks the customer to say more (with the topics to choose from). After the number of times below, a person takes over. A message that names a topic this merchant has no answer for goes to a person at once.')}</div>
        <div className="form" style={{ marginTop: 8 }}><label className="fld"><span>{T('Ask again this many times before a person takes over')} {lock ? T('(admin only)') : ''}</span><select aria-label={T('Ask again this many times')} value={s.reask_times ?? 1} disabled={lock} onChange={(e) => up({ reask_times: +e.target.value })}><option value={0}>{T('0 (hand over at once)')}</option><option value={1}>{T('1 (the usual)')}</option><option value={2}>2</option><option value={3}>3</option></select><span className="lock">{T('The customer can always ask for an agent.')}</span></label></div></div>
      <div className="card"><h3>{T('Rude or upset customers')}</h3><div className="sub">{T('The bot replies kindly first, asks for the problem and offers an agent. It closes the chat only if the customer keeps being rude.')}</div>
        <div className="form" style={{ marginTop: 8 }}><label className="fld"><span>{T('Close the chat after this many rude messages')} {lock ? T('(admin only)') : ''}</span><input type="number" min="0" max="10" value={s.abuse_close_after} disabled={lock} onChange={(e) => up({ abuse_close_after: +e.target.value })} /><span className="lock">{T('1 = close at the first rude message, 0 = never close')}</span></label></div></div>
      </>}
      {cur === 'handoff' && <>
      <div className="card"><h3 style={{ margin: 0 }}>{T('Handoff rules')}</h3>
        <div className="sub" style={{ margin: '2px 0 6px' }}>{T("When the bot hands the chat to a person it sends this merchant's handoff message (see the Messages tab).")}</div>
        <SRow title="Customer asks for a person" tag="always on" sub={'e.g. “agent”, “real person”, “转人工”'} checked disabled />
        <SRow title="Complaint or dispute" tag={lock ? 'admin only' : undefined} sub={'e.g. “money not received”, “bukti transfer”, “scam”: a person takes over. Off: the bot answers from the knowledge base as for any question.'} checked={s.handoff_complaint !== false} disabled={lock} onChange={(v) => up({ handoff_complaint: v })} />
        <SRow title="Account details written in the chat" tag={lock ? 'admin only' : undefined} sub="A phone or bank account number (8 to 16 digits): a person takes over. The bot never repeats them." checked={s.handoff_account !== false} disabled={lock} onChange={(v) => up({ handoff_account: v })} />
        <SRow title="Same question again, or the bot cannot answer" tag="always on" sub="The bot asks once, then hands over, so it never loops." checked disabled />
        <SRow title="Picture or file sent" tag="always on" sub="The bot cannot open pictures or files, so it thanks the customer and hands the chat to a person. This needs the LiveChat picture patch (see the README). A guided answer can ask for a receipt first." checked disabled />
        <div className="srow-last"><label className="fld"><span>{T('Custom trigger phrases')}</span><input value={s.trigger_phrases ?? ''} placeholder={T('vip, withdraw lambat, urgent')} onChange={(e) => up({ trigger_phrases: e.target.value })} /></label>
          <div className="sub" style={{ marginTop: 4 }}>{T('Comma separated, any language. A message that contains one of these goes straight to a person.')}</div></div></div>
      <div className="card"><h3 style={{ margin: 0 }}>{T('Who takes over')}</h3>
        <div className="form" style={{ marginTop: 10 }}>
          <label className="fld"><span>{T('Human group for handoff')} {lock ? T('(admin only)') : ''}</span><input type="number" value={s.handoff_group ?? ''} disabled={lock} onChange={(e) => up({ handoff_group: e.target.value === '' ? null : +e.target.value })} /></label>
          <div className="fld"><span>{T('Offer a person after N bot replies')}</span><div className="sub" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{T("Set on the merchant's page, step 3: it is synced with LiveChat.")}</div>
            <div><button className="btn sm" type="button" onClick={() => nav('/admin/merchants/' + p.merchant)}>{T('Open the merchant page')}</button></div></div>
        </div></div>
      </>}
      {cur === 'ai' && <>
      <div className="card"><h3 style={{ margin: 0 }}>{T('Bot instructions (style rules)')}</h3>
        <div className="sub" style={{ margin: '2px 0 10px' }}>{T('Added to the rules the AI follows when it helps: describing new words, translating answers and rewording a reply. It only shapes wording and tone and never writes new facts. A fixed reply such as “if the customer asks about promotions, always say…” belongs in the Knowledge base as an answer.')}</div>
        <textarea rows={6} maxLength={MAX_INSTRUCTIONS} aria-label={T('Bot instructions')} placeholder={T('- Always use formal, professional language.\n- Address the customer as "Dear Member".')} value={s.ai_instructions ?? ''} onChange={(e) => up({ ai_instructions: e.target.value })} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="sub"><span>{T('Added to the AI rules for this merchant. Max {n} characters.', { n: MAX_INSTRUCTIONS })}</span><span>{(s.ai_instructions ?? '').length} / {MAX_INSTRUCTIONS}</span></div>
        <div className="fld" style={{ marginTop: 10 }}><span>{T('Quick presets, click to add')}</span></div>
        <div className="presets">{PRESETS.map(([label, line]) => <button key={label} type="button" className="preset" onClick={() => addPreset(line)}>＋ {T(label)}</button>)}</div></div>
      </>}
      {cur === 'messages' && <>
      <div className="card"><h3>{T('Fixed messages')}</h3><div className="tabs" role="tablist">{LANGS.map((l) => <button key={l} type="button" role="tab" aria-selected={l === lang} onClick={() => setLang(l)}>{LN[l]}</button>)}</div>
        <div className="form" style={{ marginTop: 8 }}>
          <label className="fld full"><span>{T('Kind reply to a rude or upset customer (leave empty to use the standard reply)')}</span><textarea lang={lang} value={s.kind[lang] || ''} onChange={(e) => msg('kind', e.target.value)} /></label>
          <label className="fld full"><span>{T('Last message before the chat is closed (after repeated rude messages)')}</span><textarea lang={lang} value={s.closing[lang] || ''} onChange={(e) => msg('closing', e.target.value)} /></label>
          <label className="fld full"><span>{T('Line after the choices (leave empty to use the standard sentence)')}</span><textarea lang={lang} value={s.more_help[lang] || ''} onChange={(e) => msg('more_help', e.target.value)} /></label>
          <label className="fld full"><span>{T('Message when transferring to a human')}</span><textarea lang={lang} value={s.handoff[lang] || ''} onChange={(e) => msg('handoff', e.target.value)} /></label></div></div>
      </>}
      {changed.length > 0 && <div className="ubar" role="region" aria-label={T('Unsaved changes')}><b>{T(changed.length === 1 ? '1 unsaved change' : '{n} unsaved changes', { n: changed.length })}</b><span className="ulist">{changed.join(' · ')}</span>
        <span className="uact"><button className="btn" type="button" onClick={discard}>{T('Discard')}</button><button className="btn" type="button" onClick={() => void saveAll(false)}>{T('Save to draft')}</button><button className="btn pri" type="button" onClick={() => void saveAll(true)}>{T('Save and publish')}</button></span></div>}
    </>
  );
}
