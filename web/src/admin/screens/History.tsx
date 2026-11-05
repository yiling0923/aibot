import { api } from '../../lib/api';
import { usePanel } from '../store';

/** Versions of the merchant that is open, and (for an admin) of the word lists shared by all merchants. Each is rolled back on its own. */
export default function History() {
  const p = usePanel();
  const rows = p.history.filter((h) => (h.kind === 'merchant' ? h.merchant === p.merchant : p.isAdmin));
  const liveId = (h: (typeof rows)[number]) => rows.find((x) => x.kind === h.kind && x.merchant === h.merchant)?.id;   // the newest row of each kind is the live one
  const roll = async (id: number, label: string) => {
    if (p.changes.length && !confirm('You have unpublished changes. Rolling back will discard them. Continue?')) return;
    if (!confirm('Roll back ' + label + '? The bot will use that version straight away. Other merchants are not changed.')) return;
    try { const r = await api<{ ver: number }>('/api/admin/rollback', { id }); p.toast('Rolled back. Now live as v' + r.ver); await p.reloadAll(); }
    catch (e) { p.toast('Rollback failed: ' + (e as Error).message); }
  };
  return (
    <div className="card"><div className="head"><div><h2>History · {p.M.name}</h2><div className="sub">Every published version of this merchant, who changed it, and when. Rolling back changes only this merchant{p.isAdmin ? '. Changes to the word lists shared by all merchants have their own versions, shown here too.' : '.'}</div></div></div>
      <div style={{ marginTop: 6 }}>{rows.map((h) => {
        const shared = h.kind === 'shared'; const live = liveId(h) === h.id;
        return (
          <div className="q" key={h.id}><div><div className="t"><span className="mono">v{h.version}</span> · {h.summary}{shared ? <> <span className="pill info">shared words</span></> : null}</div><div className="sub">{h.actor} · {h.ago}</div></div>
            <div className="acts">{live ? <span className="pill ok">live</span> : <button className="btn sm" type="button" onClick={() => roll(h.id, (shared ? 'the shared words' : p.M.name) + ' to v' + h.version)}>Roll back to this</button>}</div></div>);
      })}
      {!rows.length && <div className="sub">No versions yet.</div>}</div></div>
  );
}
