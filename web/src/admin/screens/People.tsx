import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { IconBtn, Modal } from '../ui';

interface PeopleData { merchants: { code: string; name: string; tone: string; entries: number; logins: string[] }[]; users: { username: string; role: string; merchant: string | null }[] }
type Dlg = { kind: 'merchant' } | { kind: 'user' } | { kind: 'reset'; user: string } | null;

export default function People() {
  const p = usePanel(); const nav = useNavigate();
  const [P, setP] = useState<PeopleData>({ merchants: [], users: [] }); const [dlg, setDlg] = useState<Dlg>(null);
  const load = useCallback(async () => setP(await api<PeopleData>('/api/admin/people')), []);
  useEffect(() => { load().catch((e: Error) => p.toast('Could not load: ' + e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const remove = async (u: string) => {
    if (!confirm('Remove the login "' + u + '"?')) return;
    try { await api('/api/admin/users/delete', { username: u }); p.toast('Login removed'); await load(); } catch (e) { p.toast((e as Error).message); }
  };
  return (
    <>
      <div className="card"><div className="head"><div><h2>Merchants</h2><div className="sub">Each merchant has its own knowledge base, words and settings. A new merchant starts empty. Click a merchant's name to open its page: the LiveChat connection, the bot key and its own AI keys.</div></div><button className="btn pri" type="button" onClick={() => setDlg({ kind: 'merchant' })}>Add merchant</button></div>
        <table style={{ marginTop: 10 }}><thead><tr><th>Merchant</th><th>Code</th><th>Tone</th><th className="num">Entries</th><th>Logins</th></tr></thead><tbody>
          {P.merchants.map((m) => <tr key={m.code}><td><b><a href={'/admin/merchants/' + m.code} onClick={(e) => { e.preventDefault(); nav('/admin/merchants/' + m.code); }}>{m.name}</a></b></td><td className="mono">{m.code}</td><td>{m.tone}</td><td className="num">{m.entries}</td><td>{m.logins.length ? m.logins.join(', ') : <span className="sub">none</span>}</td></tr>)}</tbody></table></div>
      <div className="card"><div className="head"><div><h2>Logins</h2><div className="sub">Staff are locked to one merchant. Admins see every merchant.</div></div><button className="btn pri" type="button" onClick={() => setDlg({ kind: 'user' })}>Add login</button></div>
        <table style={{ marginTop: 10 }}><thead><tr><th>Username</th><th>Role</th><th>Merchant</th><th></th></tr></thead><tbody>
          {P.users.map((u) => (
            <tr key={u.username}><td><b>{u.username}</b>{u.username === p.me.username ? <> <span className="pill info">you</span></> : null}</td><td>{u.role === 'admin' ? 'Admin' : 'Staff'}</td><td>{u.merchant ? u.merchant : <span className="sub">all merchants</span>}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><IconBtn tip="Reset password" onClick={() => setDlg({ kind: 'reset', user: u.username })}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 21 2" /><path d="M17 6l3 3" /><path d="M14 9l2 2" /></IconBtn>{u.username === p.me.username ? null : <> <IconBtn tip="Remove login" danger onClick={() => remove(u.username)}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></IconBtn></>}</td></tr>))}</tbody></table></div>
      {dlg?.kind === 'merchant' && <MerchantDialog onClose={() => setDlg(null)} onDone={async () => { await load(); await p.reloadAll(); }} />}
      {dlg?.kind === 'user' && <UserDialog merchants={P.merchants} onClose={() => setDlg(null)} onDone={load} />}
      {dlg?.kind === 'reset' && <ResetDialog user={dlg.user} onClose={() => setDlg(null)} />}
    </>
  );
}

/** A small form dialog that shows the server's error text and closes when the save worked. */
function FormDialog({ title, label, onClose, save, done, children }: { title: string; label: string; onClose: () => void; save: () => Promise<unknown>; done: string; children: ReactNode }) {
  const p = usePanel(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await save(); onClose(); p.toast(done); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  return (
    <Modal small label={title} onClose={onClose}><h2>{title}</h2>{children}
      {err && <div className="note" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>{err}</div>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={go}>{label}</button></div></Modal>
  );
}

function MerchantDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', code: '', lang: 'en', tone: 'friendly', hg: '', lg: '', user: '', pass: '' });
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const name = f.name.trim(); const code = f.code.trim() || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    const login = f.user.trim() || f.pass ? { username: f.user.trim(), password: f.pass } : undefined;
    await api('/api/admin/merchants', { name, code, language: f.lang, tone: f.tone, handoffGroup: f.hg.trim() || null, livechatGroup: f.lg.trim() || null, login });
    await onDone();
  };
  return (
    <FormDialog title="Add merchant" label="Add merchant" onClose={onClose} save={save} done={'Added ' + f.name.trim()}>
      <div className="sub">The knowledge base starts empty. Add entries in the Knowledge base or Import screens after choosing this merchant.</div>
      <div className="form">
        <label className="fld"><span>Name</span><input placeholder="e.g. W88" autoFocus value={f.name} onChange={on('name')} /></label>
        <label className="fld"><span>Code (letters and digits, optional)</span><input placeholder="made from the name" value={f.code} onChange={on('code')} /></label>
        <label className="fld"><span>Main language</span><select value={f.lang} onChange={on('lang')}><option value="en">English</option><option value="ms">Bahasa Melayu</option><option value="zh">中文</option></select></label>
        <label className="fld"><span>Tone</span><select value={f.tone} onChange={on('tone')}><option value="friendly">Friendly</option><option value="formal">Formal</option></select></label>
        <label className="fld"><span>Human group for handoff (optional)</span><input type="number" value={f.hg} onChange={on('hg')} /></label>
        <label className="fld"><span>LiveChat group (optional)</span><input type="number" value={f.lg} onChange={on('lg')} /></label>
        <label className="fld"><span>First staff login (optional)</span><input autoComplete="off" placeholder="username" value={f.user} onChange={on('user')} /></label>
        <label className="fld"><span>Password for it</span><input type="password" autoComplete="new-password" placeholder="at least 6 characters" value={f.pass} onChange={on('pass')} /></label></div>
    </FormDialog>
  );
}

function UserDialog({ merchants, onClose, onDone }: { merchants: PeopleData['merchants']; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', pass: '', role: 'staff', merchant: merchants[0]?.code || '' });
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => { await api('/api/admin/users', { username: f.name.trim(), password: f.pass, role: f.role, merchant: f.merchant }); await onDone(); };
  return (
    <FormDialog title="Add login" label="Add login" onClose={onClose} save={save} done="Login added">
      <div className="form">
        <label className="fld"><span>Username</span><input autoComplete="off" autoFocus value={f.name} onChange={on('name')} /></label>
        <label className="fld"><span>Password</span><input type="password" autoComplete="new-password" placeholder="at least 6 characters" value={f.pass} onChange={on('pass')} /></label>
        <label className="fld"><span>Role</span><select value={f.role} onChange={on('role')}><option value="staff">Staff: one merchant</option><option value="admin">Admin: all merchants</option></select></label>
        {f.role !== 'admin' && <label className="fld"><span>Merchant</span><select value={f.merchant} onChange={on('merchant')}>{merchants.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}</select></label>}</div>
    </FormDialog>
  );
}

function ResetDialog({ user, onClose }: { user: string; onClose: () => void }) {
  const [pw, setPw] = useState('');
  return (
    <FormDialog title={'Reset password for ' + user} label="Reset password" onClose={onClose} save={() => api('/api/admin/users/password', { username: user, password: pw })} done="Password changed">
      <div className="form"><label className="fld full"><span>New password</span><input type="password" autoComplete="new-password" autoFocus placeholder="at least 6 characters" value={pw} onChange={(e) => setPw(e.target.value)} /></label></div>
    </FormDialog>
  );
}
