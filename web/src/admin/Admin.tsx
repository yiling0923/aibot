import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../styles/admin.css';
import { api } from '../lib/api';
import { PanelProvider, usePanel } from './store';
import { tChange } from './changes';
import { I18nProvider, useT } from './i18n';
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
    <I18nProvider>
      <PanelProvider onToast={toast}>
        <Shell />
        <div className="toast" hidden={!toastText} role="status">{toastText}</div>
      </PanelProvider>
    </I18nProvider>
  );
}

function Shell() {
  const p = usePanel(); const { t, lang, setLang } = useT();
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
  useEffect(() => { document.title = (n ? '(' + n + ') ' + (lang === 'zh' ? '未发布' : 'Not published') + ' · ' : '') + (lang === 'zh' ? 'LiveChat AI 机器人控制面板' : 'LiveChat AI bot, control panel'); }, [n, lang]);

  return (
    <div className={'shell' + (folded ? ' folded' : '')}>
      <aside className="side">
        <div className="brandwrap">{folded
          ? <button type="button" className="logo logobtn" aria-label={t('Show the menu')} aria-expanded={false} title={t('Show the menu')} onClick={() => setFolded(false)}><svg className="lg-a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg><svg className="lg-b" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg></button>
          : <span className="logo" aria-hidden="true"><svg className="lg-a" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></svg></span>}<div className="brand">{t('Bot Control Panel')}<small>{t('LiveChat AI bot')}</small></div>{!folded && <button type="button" className="sidetoggle" aria-label={t('Hide the menu')} aria-expanded={true} title={t('Hide the menu')} onClick={() => setFolded(true)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg></button>}</div>
        <nav className="nav" aria-label="Sections">
          {NAV_GROUPS.map(([g, all]) => [g, all.filter(([k]) => ((k !== 'users' && k !== 'billing' && k !== 'lchat') || p.isAdmin))] as const).filter(([, items]) => items.length > 0).map(([g, items]) => (
            <div className="grp" key={g}><div className="gl">{t(g)}</div>
              {items.map(([k, l]) => (
                <button key={k} type="button" title={folded ? t(l) : undefined} aria-label={folded ? t(l) : undefined} aria-current={k === view || (k === 'users' && view === 'merchants') ? 'page' : undefined} onClick={() => nav('/admin/' + k)}>
                  <NavIcon name={k} /><span>{t(l)}</span>{k === 'store' && unassigned ? <span className="cnt">{unassigned}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="whoami"><div><b>{p.me.username}</b><small>{p.isAdmin ? t('Admin · all merchants') : t('Staff · {name}', { name: p.M.name })}</small></div><button className="btn sm" type="button" onClick={signOut}>{t('Sign out')}</button></div>
          <label className="switch" title={t('Show options most staff do not need, such as question types')}><input type="checkbox" checked={p.adv} onChange={(e) => p.setAdv(e.target.checked)} /><span className="track"><span className="thumb" /></span><span className="swl">{t('Advanced options')}</span></label>
        </div>
        {folded && <button type="button" className="sidetoggle" title={t('Sign out')} aria-label={t('Sign out')} onClick={signOut}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg></button>}
      </aside>
      <div className="content">
        <header className="topbar">
          <label className="merchtop"><span>{t('Merchant')}</span>
            {p.isAdmin
              ? <select id="merchant" value={p.merchant} onChange={(e) => p.setMerchant(e.target.value)}>{p.merchants.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
              : <div className="merch-fixed">{p.M.name}</div>}
          </label>
          <div className="vers"><span className="vchip"><i />{t('Live v{v}', { v: p.ver })}</span>
            {p.M.bot_mode === 'listening' ? <span className="vchip warn" title={t('The bot is only listening: it saves conversations and does not reply. Open Learning.')}><i />{t('Listening · bot silent')}</span> : null}{n ? <><span className="vchip warn">{t(n > 1 ? 'Draft · {n} changes' : 'Draft · {n} change', { n })}</span><button className="btn sm ghost" type="button" onClick={p.discard}>{t('Discard')}</button></> : null}
          </div>
          <div className="langsw" role="group" aria-label="Panel language"><button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button><button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button></div>
          <button className="btn pri" id="publish" type="button" disabled={!n} onClick={() => setDialog('publish')}>{t('Publish')}{n ? <span className="badge">{n}</span> : null}</button>
        </header>
        <main className="main">
          {n ? (
            <div className="pubbar" role="status" aria-label="Not published yet">
              <div className="pubbar-row">
                <span><b>{t('Not live yet.')}</b> {t(n > 1 ? '{n} changes are only in your draft. Customers still get the old answers until you publish.' : '{n} change is only in your draft. Customers still get the old answers until you publish.', { n })}</span>
                <span className="pubbar-btns">
                  <button className="btn sm ghost" type="button" aria-expanded={showWhat} onClick={() => setShowWhat((v) => !v)}>{showWhat ? t('Hide changes') : t('What changed')}</button>
                  <button className="btn sm pri" type="button" onClick={() => setDialog('publish')}>{t('Review and publish')}</button>
                </span>
              </div>
              {showWhat ? <ul className="pubbar-list">{p.changes.map((c, i) => <li key={i}>{tChange(lang, c)}</li>)}</ul> : null}
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
            <Route path="lchat" element={p.isAdmin ? <LiveChatTest /> : <div className="card"><h2>{t('LiveChat test')}</h2><div className="sub">{t('Only an admin can use this screen.')}</div></div>} />
            <Route path="set" element={<Settings />} />
            <Route path="users" element={p.isAdmin ? <People /> : <div className="card"><h2>{t('Merchants & logins')}</h2><div className="sub">{t('Only an admin can use this screen.')}</div></div>} />
            <Route path="merchants/:code" element={p.isAdmin ? <MerchantPage /> : <div className="card"><h2>{t('Merchant')}</h2><div className="sub">{t('Only an admin can use this screen.')}</div></div>} />
            <Route path="billing" element={p.isAdmin ? <Billing /> : <div className="card"><h2>{t('Usage & billing')}</h2><div className="sub">{t('Only an admin can use this screen.')}</div></div>} />
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
  const p = usePanel(); const { t, lang } = useT();
  const [res, setRes] = useState<{ pass: number; total: number; results: { message: string; merchant: string; expected: string; got: string; ok: boolean; wasOk?: boolean }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    p.runTests().then((r) => { if (alive) setRes(r); }).catch((e: Error) => { if (alive) { p.toast(t('Could not run the tests: {e}', { e: e.message })); onClose(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const publish = async () => {
    setBusy(true);
    try {
      const r = await api<{ published: { scope: string; code?: string; ver: number }[] }>('/api/admin/publish', { snapshot: snapshotOf(p.draft), changes: p.changes });
      const name = (c?: string) => p.merchants.find((m) => m.code === c)?.name ?? c;
      onClose();
      p.toast(r.published.length ? t('Published: {list}', { list: r.published.map((x) => (x.scope === 'shared' ? t('shared words') : name(x.code)) + ' v' + x.ver).join(', ') }) : t('Nothing was different, so nothing was published'));
      await p.reloadAll();
    } catch (e) { setBusy(false); p.toast(t('Publish failed: {e}', { e: (e as Error).message })); }
  };
  if (!res) return <Modal small label="Publish" onClose={onClose}><h2>{t('Checking your changes…')}</h2><div className="note">{t('Running the sample customer messages on your draft.')}</div></Modal>;
  const n = p.changes.length;
  const risky = p.draft.kb.filter((e) => e.dirty).map((e) => ({ e, why: entryProblems(e) })).filter((x) => x.why.length);   // answers changed in this draft that the bot cannot use yet
  return (
    <Modal small label="Publish" onClose={onClose}>
      <h2>{t(n > 1 ? 'Publish {n} changes?' : 'Publish {n} change?', { n })}</h2>
      <ul className="plain">{p.changes.map((c, i) => <li key={i}>{tChange(lang, c)}</li>)}</ul>
      {risky.length > 0 && <div className="note" role="alert" style={{ background: 'var(--warnbg)' }}><b>{t('Check these answers first:')}</b>
        <ul className="plain">{risky.map(({ e, why }) => <li key={e.merchant + e.id}><b>{e.intent_key}</b> ({p.merchants.find((m) => m.code === e.merchant)?.name ?? e.merchant}): {why[0]}</li>)}</ul>
        <div className="sub">{t('You can still publish, but the bot will not use these answers well yet. Choose Cancel, then open Knowledge base to fix them.')}</div></div>}
      {(() => {
        const failed = res.results.filter((x) => !x.ok), broke = failed.filter((x) => x.wasOk !== false), already = failed.length - broke.length;   // "broke": passed on the live version (or no live version to compare), fails on this draft
        return <>
          <div className="note" style={broke.length ? { background: 'var(--warnbg)' } : { background: 'var(--okbg)' }}>
            {broke.length ? <b>{t(broke.length === 1 ? 'This change breaks 1 sample message:' : 'This change breaks {n} sample messages:', { n: broke.length })}</b> : <b>✓ {t('Nothing you changed broke a sample message.')}</b>}
            {' '}{already > 0 ? t(already === 1 ? '1 older sample message already fails on the live version, so it is not caused by this change.' : '{n} older sample messages already fail on the live version, so they are not caused by this change.', { n: already }) : !broke.length ? t('All {total} sample messages pass.', { total: res.total }) : ''}
            {' '}{t('The bot starts using the new version straight away. Each merchant keeps its own versions, so you can roll back one merchant from History.')}</div>
          {broke.length > 0 && <ul className="plain" aria-label={t('Failed tests')}>{broke.slice(0, 6).map((x, i) => <li key={i}><b>{p.merchants.find((m) => m.code === x.merchant)?.name ?? x.merchant}</b>: “{x.message}” {t('should be {a}, the bot gave {b}', { a: x.expected, b: x.got })}</li>)}{broke.length > 6 && <li className="sub">{t('and {n} more', { n: broke.length - 6 })}</li>}</ul>}
          <div className="sub">{t('Tests on the draft:')} {t('{pass} of {total} passed', { pass: res.pass, total: res.total })}</div>
        </>;
      })()}
      <div className="head"><button className="btn" type="button" onClick={onClose}>{t('Cancel')}</button><button className="btn pri" type="button" disabled={busy} onClick={publish}>{busy ? t('Publishing…') : t('Publish')}</button></div>
    </Modal>
  );
}
