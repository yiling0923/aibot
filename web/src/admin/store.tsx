import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { agoISO, classify, type UnmatchedRow, type HistoryItem, clone, kwStatus, snapshotOf, type AiFlags, type Draft, type KwRow, type MerchantRowAdmin, type Me, type Snapshot, type Status, type TestResult } from './model';

interface ServerState { versions: Record<string, number>; sharedVer: number | null; stamp: number; merchants: MerchantRowAdmin[]; snapshot: Snapshot; history: HistoryItem[]; user: Me; ai: AiFlags }

export interface Panel {
  me: Me; isAdmin: boolean; ver: number; sharedVer: number | null; merchants: MerchantRowAdmin[]; ai: AiFlags; history: HistoryItem[];
  merchant: string; M: MerchantRowAdmin; setMerchant: (code: string) => void;
  adv: boolean; setAdv: (on: boolean) => void;
  draft: Draft; changes: string[];
  /** Change the draft. The callback gets a copy to change and a `note` function that adds a line to the list of changes. */
  edit: (fn: (d: Draft, note: (text: string) => void) => void) => void;
  discard: () => void;
  kw: KwRow[]; kwMap: Record<string, KwRow>; ignored: Set<string>; reloadKeywords: () => Promise<void>;
  /** Messages the bot did not understand (this merchant), and a way to mark some as dealt with or open them again. */
  unmatched: UnmatchedRow[]; reloadUnmatched: () => Promise<void>; resolveUnmatched: (texts: string[], resolution: 'added' | 'ignored' | null) => Promise<void>;
  ignoreWord: (w: string) => void; unignoreWord: (w: string) => void;
  status: (w: string) => Status; typeOf: (w: string) => string;
  tests: TestResult[]; testsRun: boolean; runTests: () => Promise<{ pass: number; total: number }>;
  reloadAll: () => Promise<void>;
  toast: (text: string) => void;
}

const Ctx = createContext<Panel | null>(null);
export const usePanel = () => { const c = useContext(Ctx); if (!c) throw new Error('usePanel outside provider'); return c; };

const toDraft = (s: ServerState): Draft => ({ ...clone(s.snapshot), kb: s.snapshot.kb.map((e) => ({ ...e, updated: agoISO(e.updated) })) });

/** Loads the panel's data, keeps the unpublished draft (also in this browser, so a refresh does not lose it) and shares both with every screen. */
export function PanelProvider({ children, onToast }: { children: ReactNode; onToast: (t: string) => void }) {
  const [srv, setSrv] = useState<ServerState | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changes, setChanges] = useState<string[]>([]);
  const [merchant, setMerchantState] = useState('');
  const [adv, setAdv] = useState(false);
  const [kw, setKw] = useState<KwRow[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [testsRun, setTestsRun] = useState(false);
  const draftKey = useRef('aibot_panel_draft_v1');
  const restored = useRef(false);

  const save = (d: Draft, c: string[], stamp: number) => { try { localStorage.setItem(draftKey.current, JSON.stringify({ ver: stamp, changes: c, snapshot: snapshotOf(d) })); } catch { /* the panel works without it */ } };
  const clearSaved = () => { try { localStorage.removeItem(draftKey.current); } catch { /* ignore */ } };

  const loadKeywordsFor = useCallback(async (code: string) => {
    const rows = await api<KwRow[]>('/api/admin/keywords?merchant=' + encodeURIComponent(code));
    setKw(rows); setIgnored(new Set(rows.filter((k) => k.ignored).map((k) => k.w)));
    setUnmatched(await api<UnmatchedRow[]>('/api/admin/unmatched?merchant=' + encodeURIComponent(code)).catch(() => []));
  }, []);

  const load = useCallback(async (keep?: { merchant?: string }) => {
    const st = await api<ServerState>('/api/admin/state');
    draftKey.current = 'aibot_panel_draft_v1_' + st.user.username;
    let m = keep?.merchant || st.merchants[0]?.code || '';
    if (st.user.merchant) m = st.user.merchant;
    else if (!keep?.merchant) { try { const s = localStorage.getItem('aibot_panel_merchant_' + st.user.username); if (s && st.merchants.some((x) => x.code === s)) m = s; } catch { /* ignore */ } }
    let d = toDraft(st); let c: string[] = [];
    if (!keep) {
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey.current) || 'null');
        if (saved && saved.ver === st.stamp && saved.changes.length) {
          d = { ...saved.snapshot, kb: saved.snapshot.kb.map((e: Draft['kb'][number]) => ({ ...e, updated: 'edited', dirty: true })) }; c = saved.changes; restored.current = true;
        } else if (saved) clearSaved();
      } catch { /* ignore a broken saved draft */ }
    }
    setSrv(st); setDraft(d); setChanges(c); setMerchantState(m); setTestsRun(false); setTests([]);
    await loadKeywordsFor(m);
  }, [loadKeywordsFor]);

  useEffect(() => { load().then(() => { if (restored.current) onToast('Restored your unpublished changes'); }).catch((e: Error) => setError(e.message)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const edit: Panel['edit'] = useCallback((fn) => {
    if (!draft || !srv) return;
    const next = clone(draft); const notes: string[] = [];
    fn(next, (t) => notes.push(t));
    const nc = [...changes, ...notes]; setDraft(next); setChanges(nc); setTestsRun(false); save(next, nc, srv.stamp);
  }, [draft, changes, srv]);

  const setMerchant = (code: string) => {
    setMerchantState(code); setKw([]); setUnmatched([]);
    try { if (srv?.user.role === 'admin') localStorage.setItem('aibot_panel_merchant_' + srv.user.username, code); } catch { /* ignore */ }
    loadKeywordsFor(code).catch(() => onToast('Could not load keywords'));
  };

  const reloadUnmatched = async () => { setUnmatched(await api<UnmatchedRow[]>('/api/admin/unmatched?merchant=' + encodeURIComponent(merchant)).catch(() => [])); };
  const resolveUnmatched = async (texts: string[], resolution: 'added' | 'ignored' | null) => {
    await api('/api/admin/unmatched/resolve', { merchant, texts, resolution });
    await reloadUnmatched();
  };
  const ignoreWord = (w: string) => { setIgnored((s) => new Set(s).add(w)); api('/api/admin/keywords/ignore', { merchant, words: [w], ignored: true }).catch(() => onToast('Could not save that')); };
  const unignoreWord = (w: string) => { setIgnored((s) => { const n = new Set(s); n.delete(w); return n; }); api('/api/admin/keywords/ignore', { merchant, words: [w], ignored: false }).catch(() => onToast('Could not save that')); };

  const runTests = useCallback(async () => {
    if (!draft) return { pass: 0, total: 0 };
    const r = await api<{ results: TestResult[]; pass: number; total: number }>('/api/admin/tests', { snapshot: snapshotOf(draft), includeDrafts: false });
    setTests(r.results); setTestsRun(true); return r;
  }, [draft]);

  const kwMap = useMemo(() => Object.fromEntries(kw.map((k) => [k.w, k])), [kw]);
  const value = useMemo<Panel | null>(() => {
    if (!srv || !draft) return null;
    const M = srv.merchants.find((m) => m.code === merchant) || srv.merchants[0] || { code: merchant, name: merchant };
    return {
      me: srv.user, isAdmin: srv.user.role === 'admin', ver: srv.versions[merchant] ?? 0, sharedVer: srv.sharedVer, merchants: srv.merchants, ai: srv.ai, history: srv.history,
      merchant, M, setMerchant, adv, setAdv, draft, changes, edit,
      discard: () => { if (confirm('Throw away all unpublished changes?')) { clearSaved(); load({ merchant }).catch((e: Error) => onToast(e.message)); } },
      kw, kwMap, ignored, reloadKeywords: () => loadKeywordsFor(merchant), ignoreWord, unignoreWord, unmatched, reloadUnmatched, resolveUnmatched,
      status: (w) => kwStatus(draft, merchant, w), typeOf: (w) => classify(draft, merchant, kwMap, w),
      tests, testsRun, runTests, reloadAll: async () => { clearSaved(); await load({ merchant }); }, toast: onToast,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srv, draft, changes, merchant, adv, kw, kwMap, ignored, unmatched, tests, testsRun, edit, runTests]);

  if (error) return <div className="app"><div className="card"><h2>Cannot reach the bot server</h2><div className="sub">{error}. Start it with <span className="mono">npm run dev</span> and refresh this page.</div></div></div>;
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
