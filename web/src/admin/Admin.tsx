import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../styles/admin.css';
import { api } from '../lib/api';
import { PanelProvider, usePanel } from './store';
import { snapshotOf } from './model';
import { Modal, NavIcon } from './ui';
import Kb from './screens/Kb';
import Import from './screens/Import';
import Topics from './screens/Topics';
import Keywords from './screens/Keywords';
import Ranking from './screens/Ranking';
import TestChat from './screens/TestChat';
import Tests from './screens/Tests';
import Settings from './screens/Settings';
import People from './screens/People';
import History from './screens/History';
import Report from './screens/Report';
import Unmatched from './screens/Unmatched';

const NAV_GROUPS: [string, [string, string][]][] = [
  ['Answers', [['kb', 'Knowledge base'], ['imp', 'Import']]],
  ['Words', [['kw', 'Topics'], ['store', 'Keywords'], ['rank', 'Keyword ranking']]],
  ['Check', [['report', 'Report'], ['unm', 'Not understood'], ['chat', 'Test chat'], ['test', 'Tests']]],
  ['Setup', [['set', 'Merchant settings'], ['users', 'Merchants & logins'], ['hist', 'History']]],
];

export default function Admin() {
  const [toastText, setToastText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((t: string) => { setToastText(t); clearTimeout(timer.current); timer.current = setTimeout(() => setToastText(''), 2600); }, []);
  useEffect(() => { document.title = 'LiveChat AI bot, control panel'; }, []);
  return (
    <PanelProvider onToast={toast}>
      <Shell />
      <div className="toast" hidden={!toastText} role="status">{toastText}</div>
    </PanelProvider>
  );
}

function Shell() {
  const p = usePanel();
  const nav = useNavigate();
  const view = useLocation().pathname.split('/')[2] || 'kb';
  const [dialog, setDialog] = useState<'publish' | 'password' | null>(null);
  const signOut = async () => { try { await api('/api/auth/logout', {}); } catch { /* leaving anyway */ } window.location.replace('/login'); };
  const openUnmatched = p.unmatched.filter((r) => !r.resolved).length;
  const unassigned = p.kw.filter((k) => !p.ignored.has(k.w) && p.status(k.w).t === 'Not set yet').length;
  const n = p.changes.length;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brandwrap"><span className="logo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg></span><div className="brand">Bot Control Panel<small>LiveChat AI bot</small></div></div>
        <label className="fld merch"><span>Merchant</span>
          {p.isAdmin
            ? <select id="merchant" value={p.merchant} onChange={(e) => p.setMerchant(e.target.value)}>{p.merchants.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
            : <div className="merch-fixed">{p.M.name}</div>}
        </label>
        <nav className="nav" aria-label="Sections">
          {NAV_GROUPS.map(([g, items]) => (
            <div className="grp" key={g}><div className="gl">{g}</div>
              {items.filter(([k]) => k !== 'users' || p.isAdmin).map(([k, l]) => (
                <button key={k} type="button" aria-current={k === view ? 'page' : undefined} onClick={() => nav('/admin/' + k)}>
                  <NavIcon name={k} /><span>{l}</span>{k === 'store' && unassigned ? <span className="cnt">{unassigned}</span> : null}{k === 'unm' && openUnmatched ? <span className="cnt">{openUnmatched}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="whoami"><div><b>{p.me.username}</b><small>{p.isAdmin ? 'Admin · all merchants' : 'Staff · ' + p.M.name}</small></div><button className="btn sm" type="button" onClick={signOut}>Sign out</button></div>
          <button className="btn sm ghost" type="button" onClick={() => setDialog('password')}>Change my password</button>
          <label className="switch" title="Show options most staff do not need, such as question types"><input type="checkbox" checked={p.adv} onChange={(e) => p.setAdv(e.target.checked)} /><span className="track"><span className="thumb" /></span><span className="swl">Advanced options</span></label>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="vers"><span className="vchip"><i />Live v{p.ver}</span>
            {n ? <><span className="vchip warn">Draft · {n} change{n > 1 ? 's' : ''}</span><button className="btn sm ghost" type="button" onClick={p.discard}>Discard</button></> : null}
          </div>
          <button className="btn pri" id="publish" type="button" disabled={!n} onClick={() => setDialog('publish')}>Publish{n ? <span className="badge">{n}</span> : null}</button>
        </header>
        <main className="main">
          <Routes>
            <Route index element={<Navigate to="kb" replace />} />
            <Route path="kb" element={<Kb />} />
            <Route path="imp" element={<Import />} />
            <Route path="kw" element={<Topics />} />
            <Route path="store" element={<Keywords />} />
            <Route path="rank" element={<Ranking />} />
            <Route path="report" element={<Report />} />
            <Route path="unm" element={<Unmatched />} />
            <Route path="chat" element={<TestChat />} />
            <Route path="test" element={<Tests />} />
            <Route path="set" element={<Settings />} />
            <Route path="users" element={p.isAdmin ? <People /> : <div className="card"><h2>Merchants &amp; logins</h2><div className="sub">Only an admin can use this screen.</div></div>} />
            <Route path="hist" element={<History />} />
            <Route path="*" element={<Navigate to="/admin/kb" replace />} />
          </Routes>
        </main>
      </div>
      {dialog === 'publish' && <PublishDialog onClose={() => setDialog(null)} />}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Runs the sample messages on the draft, shows the result, then publishes. */
function PublishDialog({ onClose }: { onClose: () => void }) {
  const p = usePanel();
  const [res, setRes] = useState<{ pass: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    p.runTests().then((r) => { if (alive) setRes(r); }).catch((e: Error) => { if (alive) { p.toast('Could not run the tests: ' + e.message); onClose(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const publish = async () => {
    setBusy(true);
    try {
      const r = await api<{ published: { scope: string; code?: string; ver: number }[] }>('/api/admin/publish', { snapshot: snapshotOf(p.draft), changes: p.changes });
      const name = (c?: string) => p.merchants.find((m) => m.code === c)?.name ?? c;
      onClose();
      p.toast(r.published.length ? 'Published: ' + r.published.map((x) => (x.scope === 'shared' ? 'shared words' : name(x.code)) + ' v' + x.ver).join(', ') : 'Nothing was different, so nothing was published');
      await p.reloadAll();
    } catch (e) { setBusy(false); p.toast('Publish failed: ' + (e as Error).message); }
  };
  if (!res) return <Modal small label="Publish" onClose={onClose}><h2>Checking your changes…</h2><div className="note">Running the sample customer messages on your draft.</div></Modal>;
  const fails = res.total - res.pass; const n = p.changes.length;
  return (
    <Modal small label="Publish" onClose={onClose}>
      <h2>Publish {n} change{n > 1 ? 's' : ''}?</h2>
      <ul className="plain">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      <div className="note" style={fails ? { background: 'var(--warnbg)' } : undefined}>Tests on the draft: <b>{res.pass} of {res.total} passed</b>{fails ? `. ${fails} failed, see the Tests screen. You can still publish.` : '.'} The bot starts using the new version straight away. Each merchant keeps its own versions, so you can roll back one merchant from History.</div>
      <div className="head"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish'}</button></div>
    </Modal>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const p = usePanel();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api('/api/auth/password', { current: cur, password: pw }); onClose(); p.toast('Password changed'); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal small label="Change my password" onClose={onClose}>
      <h2>Change my password</h2>
      <div className="form">
        <label className="fld full"><span>Current password</span><input type="password" autoComplete="current-password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="fld full"><span>New password</span><input type="password" autoComplete="new-password" placeholder="at least 6 characters" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      </div>
      {err && <div className="note" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>{err}</div>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={save}>Change password</button></div>
    </Modal>
  );
}
