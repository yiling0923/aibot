import { useState } from 'react';
import { usePanel } from '../store';
import { LANGS, LN, clone } from '../model';

const TN: Record<string, string> = { deposit_status: 'Deposit status', withdraw_status: 'Withdrawal status', balance: 'Balance', transactions: 'Recent transactions', points: 'Points and level' };
const FN: Record<string, string> = { deposit_status: 'get_recent_deposits', withdraw_status: 'get_recent_withdrawals', balance: 'get_balance', transactions: 'get_recent_transactions', points: 'get_points' };

export default function Settings() {
  const p = usePanel();
  return <Form key={p.merchant} />;
}

function Form() {
  const p = usePanel(); const lock = !p.isAdmin;
  const [s, setS] = useState(() => clone(p.draft.settings[p.merchant]));
  const [lang, setLang] = useState('en');
  const up = (patch: Partial<typeof s>) => setS({ ...s, ...patch });
  const msg = (k: 'kind' | 'closing' | 'handoff' | 'more_help', v: string) => up({ [k]: { ...s[k], [lang]: v } });
  const save = () => {
    p.edit((d, note) => {
      const t = d.settings[p.merchant]; t.tone = s.tone; t.kind = s.kind; t.closing = s.closing; t.handoff = s.handoff; t.more_help = s.more_help; t.more_help_on = s.more_help_on;
      if (p.isAdmin) { t.handoff_group = s.handoff_group; t.answer = s.answer; t.clarify = s.clarify; t.tools = s.tools; t.abuse_close_after = Math.max(0, Math.min(10, +s.abuse_close_after || 0)); t.max_choices = Math.max(1, Math.min(3, Math.round(+s.max_choices || 3))); }
      note('Changed settings for ' + p.M.name);
    });
    p.toast('Saved to draft');
  };
  return (
    <>
      <div className="card"><div className="head"><div><h2>Merchant settings · {p.M.name}</h2><div className="sub">How the bot behaves for this merchant.</div></div><button className="btn pri" type="button" onClick={save}>Save to draft</button></div>
        <div className="form" style={{ marginTop: 12 }}>
          <label className="fld"><span>Tone of replies</span><select value={s.tone} onChange={(e) => up({ tone: e.target.value as 'friendly' | 'formal' })}><option value="friendly">Friendly</option><option value="formal">Formal</option></select></label>
          <label className="fld"><span>Human group for handoff {lock ? '(admin only)' : ''}</span><input type="number" value={s.handoff_group ?? ''} disabled={lock} onChange={(e) => up({ handoff_group: e.target.value === '' ? null : +e.target.value })} /></label>
          <div className="full"><div className="fld"><span>Answer when the match is at least {s.answer.toFixed(2)}</span></div><div className="slider"><span className="sub">looser</span><input type="range" min="0.5" max="0.95" step="0.01" value={s.answer} disabled={lock} onChange={(e) => up({ answer: +e.target.value })} /><span className="sub">stricter</span></div></div>
          <div className="full"><div className="fld"><span>Ask with buttons when the match is at least {s.clarify.toFixed(2)}</span></div><div className="slider"><span className="sub">looser</span><input type="range" min="0.2" max="0.7" step="0.01" value={s.clarify} disabled={lock} onChange={(e) => up({ clarify: +e.target.value })} /><span className="sub">stricter</span></div></div>
        </div></div>
      <div className="card"><h3>Account tools {lock ? <span className="lock">(admin only)</span> : null}</h3><div className="sub" style={{ marginBottom: 6 }}>A tool lets the bot read this customer's own data from the merchant's system, only after the signed login token is checked. An off tool hands the customer to a human.</div>
        {Object.keys(s.tools).map((k) => <label className="tog" key={k}><input type="checkbox" checked={!!s.tools[k]} disabled={lock} onChange={(e) => up({ tools: { ...s.tools, [k]: e.target.checked } })} /> {TN[k] || k} <span className="mono sub">{FN[k]}</span></label>)}
        <div className="note" style={{ marginTop: 8 }}>Always on and locked: the customer must be identified by a signed token. Passwords, OTP codes and full bank, card or ID numbers are never shown.</div></div>
      <div className="card"><h3>Choices the bot offers</h3><div className="sub">When the bot is not sure, it offers a few choices. Keep them short so the customer is not lost. "Talk to an agent" is always added and is not counted.</div>
        <div className="form" style={{ marginTop: 8 }}>
          <label className="fld"><span>Most choices shown at once {lock ? '(admin only)' : ''}</span><select value={s.max_choices} disabled={lock} onChange={(e) => up({ max_choices: +e.target.value })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3 (recommended)</option></select></label>
          <div className="full"><label className="tog"><input type="checkbox" checked={s.more_help_on} onChange={(e) => up({ more_help_on: e.target.checked })} /> Add a line after the choices, such as "If you need other help, you can contact an agent." <span className="sub">(reword it per language under Fixed messages)</span></label></div>
        </div></div>
      <div className="card"><h3>Rude or upset customers</h3><div className="sub">The bot replies kindly first, asks for the problem and offers an agent. It closes the chat only if the customer keeps being rude.</div>
        <div className="form" style={{ marginTop: 8 }}><label className="fld"><span>Close the chat after this many rude messages {lock ? '(admin only)' : ''}</span><input type="number" min="0" max="10" value={s.abuse_close_after} disabled={lock} onChange={(e) => up({ abuse_close_after: +e.target.value })} /><span className="lock">1 = close at the first rude message, 0 = never close</span></label></div></div>
      <div className="card"><h3>Fixed messages</h3><div className="tabs" role="tablist">{LANGS.map((l) => <button key={l} type="button" role="tab" aria-selected={l === lang} onClick={() => setLang(l)}>{LN[l]}</button>)}</div>
        <div className="form" style={{ marginTop: 8 }}>
          <label className="fld full"><span>Kind reply to a rude or upset customer (leave empty to use the standard reply)</span><textarea lang={lang} value={s.kind[lang] || ''} onChange={(e) => msg('kind', e.target.value)} /></label>
          <label className="fld full"><span>Last message before the chat is closed (after repeated rude messages)</span><textarea lang={lang} value={s.closing[lang] || ''} onChange={(e) => msg('closing', e.target.value)} /></label>
          <label className="fld full"><span>Line after the choices (leave empty to use the standard sentence)</span><textarea lang={lang} value={s.more_help[lang] || ''} onChange={(e) => msg('more_help', e.target.value)} /></label>
          <label className="fld full"><span>Message when transferring to a human</span><textarea lang={lang} value={s.handoff[lang] || ''} onChange={(e) => msg('handoff', e.target.value)} /></label></div></div>
    </>
  );
}
