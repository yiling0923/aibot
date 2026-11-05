import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { snapshotOf } from '../model';

export default function TestChat() {
  const p = usePanel(); const nav = useNavigate();
  const [inc, setInc] = useState(true); const [src, setSrc] = useState(''); const [info, setInfo] = useState(''); const [live, setLive] = useState<{ words: number; unmatched: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async (include = inc) => {
    try {
      const r = await api<{ draftId: string }>('/api/admin/draft', { snapshot: snapshotOf(p.draft), includeDrafts: include });
      setSrc('/chat?draft=' + r.draftId + '&merchant=' + encodeURIComponent(p.merchant) + (p.isAdmin ? '' : '&only=' + encodeURIComponent(p.merchant)));
      const mine = p.draft.kb.filter((e) => e.merchant === p.merchant); const n = mine.length, d = mine.filter((e) => e.status !== 'live').length;
      setInfo(`Using ${p.M.name}: ${include ? n : n - d} entries` + (include ? ` (${d} draft included)` : ` (live only, ${d} draft left out)`) + '. Last loaded just now.');
    } catch (e) { setInfo('Could not start the test chat: ' + (e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.draft, p.merchant, inc]);
  const liveInfo = useCallback(async () => { try { setLive(await api('/api/keywords/summary?merchant=' + encodeURIComponent(p.merchant))); } catch { setLive(null); } }, [p.merchant]);

  useEffect(() => { void load(); void liveInfo(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.merchant]);

  // the chat tells this page when it saved new words
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      const d = e.data as { kind?: string; fresh?: string[] } | null;
      if (!d || d.kind !== 'botlog' || e.source !== frame.current?.contentWindow) return;
      await p.reloadKeywords(); void liveInfo();
      if (d.fresh?.length) p.toast('Saved to Keywords: ' + d.fresh.slice(0, 5).join(', ') + (d.fresh.length > 5 ? '…' : ''));
    };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  });

  // grow the frame to fit the chat
  useEffect(() => {
    const t = setInterval(() => { const f = frame.current; if (!f) return; try { const h = f.contentDocument?.documentElement.scrollHeight || 0; if (h > 300) f.style.height = h + 4 + 'px'; } catch { /* other origin */ } }, 700);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="card"><div className="head"><div><h2>Test chat</h2><div className="sub">Chat with your unpublished changes. Nothing goes live.</div></div>
        <div className="tools"><label className="tog" style={{ padding: 0 }}><input type="checkbox" checked={inc} onChange={(e) => { setInc(e.target.checked); void load(e.target.checked); }} /> Include draft entries</label>
          <button className="btn pri" type="button" onClick={() => { void load(); p.toast('Chat reloaded with your latest draft'); }}>Reload with my latest changes</button></div></div>
        <div className="quiet">{info}</div>
        <div className="quiet">{live && <>Saved to Keywords for {p.M.name}: <b>{live.words}</b> word{live.words === 1 ? '' : 's'} · <b>{live.unmatched}</b> message{live.unmatched === 1 ? '' : 's'} the bot did not understand. <button className="btn sm pri" type="button" onClick={() => nav('/admin/store')}>Keywords</button> <button className="btn sm" type="button" onClick={() => nav('/admin/rank')}>Keyword ranking</button></>}</div>
      </div>
      <iframe ref={frame} src={src || 'about:blank'} title="Chat test" style={{ width: '100%', height: 820, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg)' }} />
    </>
  );
}
