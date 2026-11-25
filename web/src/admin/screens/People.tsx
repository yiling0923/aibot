import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { IconBtn, Modal } from '../ui';
import { useT } from '../i18n';

interface PeopleData { merchants: { code: string; name: string; tone: string; entries: number; logins: string[]; link?: { hasKey: boolean; lastUsedAt: string | null } }[]; users: { username: string; role: string; merchant: string | null }[] }
/** "2h ago", "3d ago": how long since a time. */
const ago = (iso: string | null, T: (s: string, v?: Record<string, string | number>) => string) => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? T('just now') : m < 60 ? T('{n} min ago', { n: m }) : m < 1440 ? T('{n}h ago', { n: Math.round(m / 60) }) : T('{n}d ago', { n: Math.round(m / 1440) }); };
type Dlg = { kind: 'merchant' } | { kind: 'user' } | { kind: 'reset'; user: string } | null;

const TINTS: [string, string][] = [['#e3f1f3', '#0f6f78'], ['#efe9fb', '#6d3fc0'], ['#fdecdc', '#b45309'], ['#e2f3ea', '#177a4b'], ['#e8f1fb', '#2563a8'], ['#fbe6ee', '#be185d']];
/** A round badge with the first letters of a name, in a soft colour that stays the same for the same name. */
function Av({ name, seed }: { name: string; seed: string }) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = TINTS[h % TINTS.length]; const ini = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span className="av" style={{ background: bg, color: fg }} aria-hidden="true">{ini}</span>;
}

export default function People() {
  const p = usePanel(); const nav = useNavigate(); const { t: T } = useT();
  const [P, setP] = useState<PeopleData>({ merchants: [], users: [] }); const [dlg, setDlg] = useState<Dlg>(null);
  const [mq, setMq] = useState(''); const [role, setRole] = useState<'all' | 'admin' | 'staff'>('all');
  const load = useCallback(async () => setP(await api<PeopleData>('/api/admin/people')), []);
  useEffect(() => { load().catch((e: Error) => p.toast(T('Could not load: ') + e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const remove = async (u: string) => {
    if (!confirm(T('Remove the login "{u}"?', { u }))) return;
    try { await api('/api/admin/users/delete', { username: u }); p.toast(T('Login removed')); await load(); } catch (e) { p.toast((e as Error).message); }
  };
  const Q = mq.trim().toLowerCase();
  const merchants = P.merchants.filter((m) => !Q || (m.name + ' ' + m.code).toLowerCase().includes(Q));
  const users = P.users.filter((u) => role === 'all' || u.role === role);
  const admins = P.users.filter((u) => u.role === 'admin').length;
  return (
    <>
      <div className="card"><div className="head"><div><h2>{T('Merchants')} <span className="cnt2">{P.merchants.length}</span></h2><div className="sub">{T('Each merchant has its own answers, words and settings. Open a merchant to connect it to LiveChat and set its AI keys.')}</div></div><button className="btn pri" type="button" onClick={() => setDlg({ kind: 'merchant' })}>＋ {T('Add merchant')}</button></div>
        {P.merchants.length > 5 && <div className="pbar"><input type="search" aria-label={T('Find a merchant')} placeholder={T('Find a merchant')} value={mq} onChange={(e) => setMq(e.target.value)} /></div>}
        <table className="ptable"><thead><tr><th>{T('Merchant')}</th><th>{T('Tone')}</th><th className="num">{T('Answers')}</th><th>{T('Staff login')}</th><th>{T('LiveChat link')}</th><th></th></tr></thead><tbody>
          {merchants.map((m) => <tr key={m.code} className="row" onClick={() => nav('/admin/merchants/' + m.code)}>
            <td><div className="mcell"><Av name={m.name} seed={m.code} /><div><a className="mname" href={'/admin/merchants/' + m.code} onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav('/admin/merchants/' + m.code); }}>{m.name}</a><span className="mcode">{m.code}</span></div></div></td>
            <td><span className="pill">{T(m.tone)}</span></td><td className="num">{m.entries}</td>
            <td>{m.logins.length ? m.logins.join(', ') : <span className="sub">{T('none')}</span>}</td>
            <td>{m.link?.hasKey ? <span className="pill ok">{T('Connected')}{m.link.lastUsedAt ? ' · ' + T('used {a}', { a: ago(m.link.lastUsedAt, T) }) : ' · ' + T('not used yet')}</span> : <span className="pill warn">{T('No bot key yet')}</span>}</td>
            <td className="num" onClick={(e) => e.stopPropagation()}><IconBtn tip={T('Open')} onClick={() => nav('/admin/merchants/' + m.code)}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></IconBtn></td></tr>)}
          {!merchants.length && <tr><td colSpan={6}><div className="kwempty"><b>{P.merchants.length ? T('No merchant matches “{q}”.', { q: mq.trim() }) : T('No merchants yet.')}</b><span>{T(P.merchants.length ? 'Check the spelling, or clear the search.' : 'Press “Add merchant” to create the first one.')}</span></div></td></tr>}</tbody></table></div>
      <div className="card"><div className="head"><div><h2>{T('Logins')} <span className="cnt2">{P.users.length}</span></h2><div className="sub">{T('Staff can only see their own merchant. Admins see every merchant.')}</div></div><button className="btn pri" type="button" onClick={() => setDlg({ kind: 'user' })}>＋ {T('Add login')}</button></div>
        {P.users.length > 4 && <div className="pbar"><div className="segs" role="group" aria-label={T('Show logins')}>{([['all', 'All', P.users.length], ['admin', 'Admins', admins], ['staff', 'Staff', P.users.length - admins]] as const).map(([k, l, n]) => <button key={k} type="button" aria-pressed={role === k} onClick={() => setRole(k)}>{T(l)} <span className="n">{n}</span></button>)}</div></div>}
        <table className="ptable"><thead><tr><th>{T('Username')}</th><th>{T('Role')}</th><th>{T('Merchant')}</th><th></th></tr></thead><tbody>
          {users.map((u) => (
            <tr key={u.username}><td><div className="mcell"><Av name={u.username} seed={u.username} /><div><b>{u.username}</b>{u.username === p.me.username ? <> <span className="pill info">{T('you')}</span></> : null}</div></div></td><td><span className={'pill' + (u.role === 'admin' ? ' info' : '')}>{u.role === 'admin' ? T('Admin|role') : T('Staff')}</span></td>
              <td>{u.merchant ? (P.merchants.find((m) => m.code === u.merchant)?.name ?? u.merchant) : <span className="sub">{T('All merchants')}</span>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}><IconBtn tip={T('Change password')} onClick={() => setDlg({ kind: 'reset', user: u.username })}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 21 2" /><path d="M17 6l3 3" /><path d="M14 9l2 2" /></IconBtn>{u.username === p.me.username ? null : <> <IconBtn tip={T('Delete')} danger onClick={() => remove(u.username)}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></IconBtn></>}</td></tr>))}
          {!users.length && <tr><td colSpan={4}><div className="kwempty"><b>{T(role === 'admin' ? 'No admin logins yet.' : 'No staff logins yet.')}</b><span>{T('Press “Add login” to make one.')}</span></div></td></tr>}</tbody></table></div>
      {dlg?.kind === 'merchant' && <MerchantDialog onClose={() => setDlg(null)} onDone={async () => { await load(); await p.reloadAll(); }} />}
      {dlg?.kind === 'user' && <UserDialog merchants={P.merchants} onClose={() => setDlg(null)} onDone={load} />}
      {dlg?.kind === 'reset' && <ResetDialog user={dlg.user} onClose={() => setDlg(null)} />}
    </>
  );
}

/** A small form dialog that shows the server's error text and closes when the save worked. */
function FormDialog({ title, label, onClose, save, done, children }: { title: string; label: string; onClose: () => void; save: () => Promise<unknown>; done: string; children: ReactNode }) {
  const p = usePanel(); const { t: T } = useT(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await save(); onClose(); p.toast(done); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  return (
    <Modal small label={title} onClose={onClose}><h2>{title}</h2>{children}
      {err && <div className="note" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>{err}</div>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>{T('Cancel')}</button><button className="btn pri" type="button" disabled={busy} onClick={go}>{label}</button></div></Modal>
  );
}

function MerchantDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const nav = useNavigate(); const { t: T } = useT();
  const [f, setF] = useState({ name: '', code: '', lang: 'en', tone: 'friendly', lg: '', user: '', pass: '' });
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const name = f.name.trim(); const code = f.code.trim() || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    const login = f.user.trim() || f.pass ? { username: f.user.trim(), password: f.pass } : undefined;
    await api('/api/admin/merchants', { name, code, language: f.lang, tone: f.tone, livechatGroup: f.lg.trim() || null, login });
    await onDone(); nav('/admin/merchants/' + code);                                  // the new merchant's page opens with its setup checklist
  };
  return (
    <FormDialog title={T('Add merchant')} label={T('Add merchant')} onClose={onClose} save={save} done={T('Added {n}', { n: f.name.trim() })}>
      <div className="sub">{T("The knowledge base starts empty. After you save, this merchant's page opens with a setup checklist that shows what is left to do (the bot key, the answers and more). This adds the merchant to the bot only: LiveChat keeps its own list of merchants, so the same merchant must exist there too.")}</div>
      <div className="form">
        <label className="fld"><span>{T('Name')}</span><input placeholder={T('e.g. W88')} autoFocus value={f.name} onChange={on('name')} /></label>
        <label className="fld"><span>{T('Code (letters and digits, optional)')}</span><input placeholder={T('made from the name')} value={f.code} onChange={on('code')} /></label>
        <label className="fld"><span>{T('Main language')}</span><select value={f.lang} onChange={on('lang')}><option value="en">English</option><option value="ms">Bahasa Melayu</option><option value="zh">中文</option><option value="vi">Tiếng Việt</option><option value="th">ไทย</option><option value="tl">Filipino</option></select></label>
        <label className="fld"><span>{T('Tone')}</span><select value={f.tone} onChange={on('tone')}><option value="friendly">{T('Friendly')}</option><option value="formal">{T('Formal')}</option></select></label>
        <label className="fld"><span>{T('LiveChat group (optional)')}</span><input type="number" value={f.lg} onChange={on('lg')} /></label>
        <label className="fld"><span>{T('First staff login (optional)')}</span><input autoComplete="off" placeholder={T('username')} value={f.user} onChange={on('user')} /></label>
        <label className="fld"><span>{T('Password for it')}</span><input type="password" autoComplete="new-password" placeholder={T('at least 6 characters')} value={f.pass} onChange={on('pass')} /></label></div>
    </FormDialog>
  );
}

function UserDialog({ merchants, onClose, onDone }: { merchants: PeopleData['merchants']; onClose: () => void; onDone: () => Promise<void> }) {
  const { t: T } = useT();
  const [f, setF] = useState({ name: '', pass: '', role: 'staff', merchant: merchants[0]?.code || '' });
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => { await api('/api/admin/users', { username: f.name.trim(), password: f.pass, role: f.role, merchant: f.merchant }); await onDone(); };
  return (
    <FormDialog title={T('Add login')} label={T('Add login')} onClose={onClose} save={save} done={T('Login added')}>
      <div className="form">
        <label className="fld"><span>{T('Username')}</span><input autoComplete="off" autoFocus value={f.name} onChange={on('name')} /></label>
        <label className="fld"><span>{T('Password')}</span><input type="password" autoComplete="new-password" placeholder={T('at least 6 characters')} value={f.pass} onChange={on('pass')} /></label>
        <label className="fld"><span>{T('Role')}</span><select value={f.role} onChange={on('role')}><option value="staff">{T('Staff: one merchant')}</option><option value="admin">{T('Admin: all merchants')}</option></select></label>
        {f.role !== 'admin' && <label className="fld"><span>{T('Merchant')}</span><select value={f.merchant} onChange={on('merchant')}>{merchants.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</select></label>}</div>
    </FormDialog>
  );
}

function ResetDialog({ user, onClose }: { user: string; onClose: () => void }) {
  const { t: T } = useT(); const [pw, setPw] = useState('');
  return (
    <FormDialog title={T('Reset password for {u}', { u: user })} label={T('Reset password')} onClose={onClose} save={() => api('/api/admin/users/password', { username: user, password: pw })} done={T('Password changed')}>
      <div className="form"><label className="fld full"><span>{T('New password')}</span><input type="password" autoComplete="new-password" autoFocus placeholder={T('at least 6 characters')} value={pw} onChange={(e) => setPw(e.target.value)} /></label></div>
    </FormDialog>
  );
}
