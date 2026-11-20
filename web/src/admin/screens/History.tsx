import { api } from '../../lib/api';
import { usePanel } from '../store';
import { useT } from '../i18n';

/** Versions of the merchant that is open, and (for an admin) of the word lists shared by all merchants. Each is rolled back on its own. */
export default function History() {
  const p = usePanel(); const { t: T } = useT();
  const rows = p.history.filter((h) => (h.kind === 'merchant' ? h.merchant === p.merchant : p.isAdmin));
  const newest = (h: (typeof rows)[number]) => Math.max(...rows.filter((x) => x.kind === h.kind && x.merchant === h.merchant).map((x) => x.version));   // the newest version of each kind is the live one
  const roll = async (merchant: string | null, version: number, label: string) => {
    if (p.changes.length && !confirm(T('You have unpublished changes. Rolling back will discard them. Continue?'))) return;
    if (!confirm(T('Roll back {w}? The bot will use that version straight away. Other merchants are not changed.', { w: label }))) return;
    try { const r = await api<{ ver: number }>('/api/admin/rollback', { merchant, version }); p.toast(T('Rolled back. Now live as v{v}', { v: r.ver })); await p.reloadAll(); }
    catch (e) { p.toast(T('Rollback failed: ') + (e as Error).message); }
  };
  return (
    <div className="card"><div className="head"><div><h2>{T('History')} · {p.M.name}</h2><div className="sub">{T('Every published version of this merchant, who changed it, and when. Rolling back changes only this merchant')}{T(p.isAdmin ? '. Changes to the word lists shared by all merchants have their own versions, shown here too.' : '.')}</div></div></div>
      <div style={{ marginTop: 6 }}>{rows.map((h) => {
        const shared = h.kind === 'shared'; const live = newest(h) === h.version;
        return (
          <div className="q" key={(h.merchant ?? 'shared') + h.version}><div><div className="t"><span className="mono">v{h.version}</span> · {h.summary}{shared ? <> <span className="pill info">{T('shared words')}</span></> : null}</div><div className="sub">{h.actor} · {h.ago}</div></div>
            <div className="acts">{live ? <span className="pill ok">{T('live')}</span> : <button className="btn sm" type="button" onClick={() => roll(h.merchant, h.version, (shared ? T('the shared words') : p.M.name) + ' ' + T('to v{v}', { v: h.version }))}>{T('Roll back to this')}</button>}</div></div>);
      })}
      {!rows.length && <div className="sub">{T('No versions yet.')}</div>}</div></div>
  );
}
