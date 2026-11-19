import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../styles/admin.css';
import { api } from '../lib/api';
import { PanelProvider, usePanel } from './store';
import { entryProblems, snapshotOf } from './model';
import { Modal, NavIcon } from './ui';
import Kb from './screens/Kb';
import Import from './screens/Import';
import Topics from './screens/Topics';
import Keywords from './screens/Keywords';
import Ranking from './screens/Ranking';
import LiveChatTest from './screens/LiveChatTest';
import Settings from './screens/Settings';
import People from './screens/People';
import MerchantPage from './screens/MerchantPage';
import Billing from './screens/Billing';
import History from './screens/History';
import Report from './screens/Report';
import Guide from './screens/Guide';
import Learning from './screens/Learning';

const NAV_GROUPS: [string, [string, string][]][] = [
  ['Answers', [['kb', 'Knowledge base'], ['imp', 'Import'], ['guide', 'Import guide'], ['learn', 'Learning']]],
  ['Words', [['kw', 'Topics'], ['store', 'Keywords'], ['rank', 'Keyword ranking']]],
  ['Check', [['report', 'Report']]],
  ['Setup', [['set', 'Merchant settings'], ['hist', 'History']]],
  ['Connect', [['lchat', 'LiveChat test']]],
  ['Admin', [['users', 'Merchants & logins'], ['billing', 'Usage & billing']]],
];

export default function Admin() {
  const [toastText, setToastText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((t: string) => { setToastText(t); clearTimeout(timer.current); timer.current = setTimeout(() => setToastText(''), 2600); }, []);
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
  const [dialog, setDialog] = useState<'publish' | null>(null);
  const where = useLocation();
  useEffect(() => { if ((where.state as { publish?: boolean } | null)?.publish) setDialog('publish'); }, [where.key]);        // "Import and publish" opens the Publish window
  const signOut = async () => { try { await api('/api/auth/logout', {}); } catch { /* leaving anyway */ } window.location.replace('/login'); };
  const unassigned = p.kw.filter((k) => !p.ignored.has(k.w) && p.status(k.w).t === 'Not set yet').length;
  const n = p.changes.length;
  const [showWhat, setShowWhat] = useState(false);
  const [folded, setFoldedState] = useState(() => { try { return localStorage.getItem('sideFolded') === '1'; } catch { return false; } });   // the left menu can fold to icons
  const setFolded = (v: boolean) => { setFoldedState(v); try { localStorage.setItem('sideFolded', v ? '1' : '0'); } catch { /* ignore */ } };
  useEffect(() => { document.title = (n ? '(' + n + ') Not published · ' : '') + 'LiveChat AI bot, control panel'; }, [n]);

  return (
    <div className={'shell' + (folded ? ' folded' : '')}>
      <aside className="side">
        <div className="brandwrap">{folded
          ? <button type="button" className="logo logobtn" aria-label="Show the menu" aria-expanded={false} title="Show the menu" onClick={() => setFolded(false)}><svg className="lg-a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg><svg className="lg-b" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg></button>
          : <span className="logo" aria-hidden="true"><svg className="lg-a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg></span>}<div className="brand">Bot Control Panel<small>LiveChat AI bot</small></div>{!folded && <button type="button" className="sidetoggle" aria-label="Hide the menu" aria-expanded={true} title="Hide the menu" onClick={() => setFolded(true)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg></button>}</div>
        <label className="fld merch"><span>Merchant</span>
          {p.isAdmin
            ? <select id="merchant" value={p.merchant} onChange={(e) => p.setMerchant(e.target.value)}>{p.merchants.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
            : <div className="merch-fixed">{p.M.name}</div>}
        </label>
        <nav className="nav" aria-label="Sections">
          {NAV_GROUPS.map(([g, all]) => [g, all.filter(([k]) => ((k !== 'users' && k !== 'billing' && k !== 'lchat') || p.isAdmin))] as const).filter(([, items]) => items.length > 0).map(([g, items]) => (
            <div className="grp" key={g}><div className="gl">{g}</div>
              {items.map(([k, l]) => (
                <button key={k} type="button" title={folded ? l : undefined} aria-label={folded ? l : undefined} aria-current={k === view || (k === 'users' && view === 'merchants') ? 'page' : undefined} onClick={() => nav('/admin/' + k)}>
                  <NavIcon name={k} /><span>{l}</span>{k === 'store' && unassigned ? <span className="cnt">{unassigned}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="whoami"><div><b>{p.me.username}</b><small>{p.isAdmin ? 'Admin · all merchants' : 'Staff · ' + p.M.name}</small></div><button className="btn sm" type="button" onClick={signOut}>Sign out</button></div>
          <label className="switch" title="Show options most staff do not need, such as question types"><input type="checkbox" checked={p.adv} onChange={(e) => p.setAdv(e.target.checked)} /><span className="track"><span className="thumb" /></span><span className="swl">Advanced options</span></label>
        </div>
        {folded && <button type="button" className="sidetoggle" title="Sign out" aria-label="Sign out" onClick={signOut}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg></button>}
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="vers"><span className="vchip"><i />Live v{p.ver}</span>
            {p.M.bot_mode === 'listening' ? <span className="vchip warn" title="The bot is only listening: it saves conversations and does not reply. Open Learning."><i />Listening · bot silent</span> : null}{n ? <><span className="vchip warn">Draft · {n} change{n > 1 ? 's' : ''}</span><button className="btn sm ghost" type="button" onClick={p.discard}>Discard</button></> : null}
          </div>
          <button className="btn pri" id="publish" type="button" disabled={!n} onClick={() => setDialog('publish')}>Publish{n ? <span className="badge">{n}</span> : null}</button>
        </header>
        <main className="main">
          {n ? (
            <div className="pubbar" role="status" aria-label="Not published yet">
              <div className="pubbar-row">
                <span><b>Not live yet.</b> {n} change{n > 1 ? 's are' : ' is'} only in your draft. Customers still get the old answers until you publish.</span>
                <span className="pubbar-btns">
                  <button className="btn sm ghost" type="button" aria-expanded={showWhat} onClick={() => setShowWhat((v) => !v)}>{showWhat ? 'Hide changes' : 'What changed'}</button>
                  <button className="btn sm pri" type="button" onClick={() => setDialog('publish')}>Review and publish</button>
                </span>
              </div>
              {showWhat ? <ul className="pubbar-list">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
            </div>
          ) : null}
          <Routes>
            <Route index element={<Navigate to="kb" replace />} />
            <Route path="kb" element={<Kb />} />
            <Route path="imp" element={<Import />} />
            <Route path="kw" element={<Topics />} />
            <Route path="store" element={<Keywords />} />
            <Route path="rank" element={<Ranking />} />
            <Route path="report" element={<Report />} />
            <Route path="lchat" element={p.isAdmin ? <LiveChatTest /> : <div className="card"><h2>LiveChat test</h2><div className="sub">Only an admin can use this screen.</div></div>} />
            <Route path="set" element={<Settings />} />
            <Route path="users" element={p.isAdmin ? <People /> : <div className="card"><h2>Merchants &amp; logins</h2><div className="sub">Only an admin can use this screen.</div></div>} />
            <Route path="merchants/:code" element={p.isAdmin ? <MerchantPage /> : <div className="card"><h2>Merchant</h2><div className="sub">Only an admin can use this screen.</div></div>} />
            <Route path="billing" element={p.isAdmin ? <Billing /> : <div className="card"><h2>Usage &amp; billing</h2><div className="sub">Only an admin can use this screen.</div></div>} />
            <Route path="guide" element={<Guide />} />
            <Route path="learn" element={<Learning />} />
            <Route path="hist" element={<History />} />
            <Route path="*" element={<Navigate to="/admin/kb" replace />} />
          </Routes>
        </main>
      </div>
      {dialog === 'publish' && <PublishDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Runs the sample messages on the draft, shows the result, then publishes. */
function PublishDialog({ onClose }: { onClose: () => void }) {
  const p = usePanel();
  const [res, setRes] = useState<{ pass: number; total: number; results: { message: string; merchant: string; expected: string; got: string; ok: boolean }[] } | null>(null);
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
  const risky = p.draft.kb.filter((e) => e.dirty).map((e) => ({ e, why: entryProblems(e) })).filter((x) => x.why.length);   // answers changed in this draft that the bot cannot use yet
  return (
    <Modal small label="Publish" onClose={onClose}>
      <h2>Publish {n} change{n > 1 ? 's' : ''}?</h2>
      <ul className="plain">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      {risky.length > 0 && <div className="note" role="alert" style={{ background: 'var(--warnbg)' }}><b>Check these answers first:</b>
        <ul className="plain">{risky.map(({ e, why }) => <li key={e.merchant + e.id}><b>{e.intent_key}</b> ({p.merchants.find((m) => m.code === e.merchant)?.name ?? e.merchant}): {why[0]}</li>)}</ul>
        <div className="sub">You can still publish, but the bot will not use these answers well yet. Choose Cancel, then open Knowledge base to fix them.</div></div>}
      <div className="note" style={fails ? { background: 'var(--warnbg)' } : undefined}>Tests on the draft: <b>{res.pass} of {res.total} passed</b>{fails ? `. ${fails} failed (listed below). You can still publish.` : '.'} The bot starts using the new version straight away. Each merchant keeps its own versions, so you can roll back one merchant from History.</div>
      {fails > 0 && <ul className="plain" aria-label="Failed tests">{res.results.filter((t) => !t.ok).slice(0, 6).map((t, i) => <li key={i}><b>{p.merchants.find((m) => m.code === t.merchant)?.name ?? t.merchant}</b>: “{t.message}” should be {t.expected}, the bot gave {t.got}</li>)}{fails > 6 && <li className="sub">and {fails - 6} more</li>}</ul>}
      <div className="head"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish'}</button></div>
    </Modal>
  );
}
