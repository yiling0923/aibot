import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { usePanel } from './store';

export interface Health {
  state: 'ok' | 'slow' | 'down' | 'badkey'; reason: string; since: string | null; windowMinutes: number; total: number;
  counts: { ok: number; slow: number; timeout: number; error: number; badkey: number }; failed: number; db: 'up' | 'down' | 'unknown'; lastError: string | null;
  worst: { merchant: string; failed: number; total: number }[]; lastAlertAt: string | null; alerts: { webhook: boolean; telegram: boolean };
}
const TITLE: Record<string, string> = { down: 'The bot has a problem', slow: 'The bot is slow', badkey: 'LiveChat is using a wrong bot key' };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

/** Asks the server how the bot is doing now and then (every 30 seconds). */
function useHealth(): [Health | null, () => void] {
  const [h, setH] = useState<Health | null>(null);
  const load = useCallback(() => { api<Health>('/api/admin/health').then(setH).catch(() => undefined); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  return [h, load];
}

/** A bar at the top of every screen, only when the bot is down, slow or called with a wrong key. */
export function HealthBanner() {
  const [h] = useHealth(); const p = usePanel(); const nav = useNavigate();
  if (!h || !['down', 'slow', 'badkey'].includes(h.state)) return null;
  return (
    <div className={'hbanner ' + h.state} role="alert" aria-label="Bot problem">
      <div><b>{TITLE[h.state]}</b>{h.since ? <span className="sub"> · since {time(h.since)}</span> : null}<div>{h.reason}{h.lastError && h.state === 'down' ? <span className="sub"> Last error: {h.lastError}</span> : null}</div></div>
      {p.isAdmin && <button className="btn sm" type="button" onClick={() => nav('/admin/users')}>Details</button>}
    </div>
  );
}

/** For the admin (Merchants & logins): how the bot did in the last minutes, where alerts go, and a button to send a test alert. */
export function HealthCard() {
  const [h, load] = useHealth(); const p = usePanel(); const [busy, setBusy] = useState(false); const [res, setRes] = useState('');
  const test = async () => {
    setBusy(true); setRes('');
    try { const r = await api<{ sent: { webhook: string; telegram: string } }>('/api/admin/health/test', {}); setRes(`Webhook: ${r.sent.webhook}. Telegram: ${r.sent.telegram}.`); load(); }
    catch (e) { setRes((e as Error).message); } finally { setBusy(false); }
  };
  if (!h) return null;
  const none = !h.alerts.webhook && !h.alerts.telegram;
  return (
    <div className="card" aria-label="Bot health"><div className="head"><div><h2>Bot health <span className={'pill ' + (h.state === 'ok' ? 'ok' : h.state === 'slow' ? 'warn' : 'bad')}>{h.state === 'ok' ? 'normal' : h.state === 'slow' ? 'slow' : h.state === 'badkey' ? 'wrong key' : 'problem'}</span></h2>
      <div className="sub">How LiveChat's calls to the bot went in the last {h.windowMinutes} minutes. {h.reason}</div></div>
      {p.isAdmin && <button className="btn sm" type="button" disabled={busy} onClick={() => void test()}>{busy ? 'Sending…' : 'Send a test alert'}</button>}</div>
      <div className="stats" style={{ marginTop: 10 }}>
        <div className="stat"><b>{h.total}</b>calls</div><div className="stat"><b>{h.counts.ok}</b>fine</div><div className="stat"><b>{h.counts.slow}</b>slow</div>
        <div className="stat"><b>{h.counts.timeout}</b>too long (handed over)</div><div className="stat"><b>{h.counts.error}</b>failed</div><div className="stat"><b>{h.counts.badkey}</b>wrong key</div>
        <div className="stat"><b>{h.db === 'down' ? 'down' : h.db === 'up' ? 'up' : '—'}</b>database</div>
      </div>
      {h.worst.length > 0 && <div className="sub" style={{ marginTop: 8 }}>Most failures: {h.worst.map((w) => `${w.merchant} (${w.failed} of ${w.total})`).join(', ')}.</div>}
      <div className="note" style={{ marginTop: 10 }}>
        <b>Alerts:</b> webhook {h.alerts.webhook ? <b>on</b> : 'off'} · Telegram {h.alerts.telegram ? <b>on</b> : 'off'}.{' '}
        {none ? 'No alert address is set, so a problem only shows here. Set ALERT_WEBHOOK_URL (Slack, Discord, Teams) or ALERT_TELEGRAM_TOKEN and ALERT_TELEGRAM_CHAT_ID in the .env file and restart the bot. ' : ''}
        The bot cannot tell you that it has stopped: run <span className="mono">npm run watchdog</span> on another computer for that.
        {res && <div style={{ marginTop: 6 }} aria-label="Test alert result"><b>Test:</b> {res}</div>}</div>
    </div>
  );
}
