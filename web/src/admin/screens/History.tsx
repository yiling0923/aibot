import { api } from '../../lib/api';
import { usePanel } from '../store';

export default function History() {
  const p = usePanel();
  const roll = async (v: string) => {
    if (p.changes.length && !confirm('You have unpublished changes. Rolling back will discard them. Continue?')) return;
    if (!confirm('Roll back to ' + v + '? The bot will use that version straight away.')) return;
    try { const r = await api<{ ver: number }>('/api/admin/rollback', { version: +v.slice(1), actor: p.isAdmin ? 'admin' : 'staff' }); p.toast('Rolled back. Now live as v' + r.ver); await p.reloadAll(); }
    catch (e) { p.toast('Rollback failed: ' + (e as Error).message); }
  };
  return (
    <div className="card"><div className="head"><div><h2>History</h2><div className="sub">Every published version, who changed it, and when. Roll back if a change goes wrong.</div></div></div>
      <div style={{ marginTop: 6 }}>{p.history.map((h, i) => (
        <div className="q" key={h[0]}><div><div className="t"><span className="mono">{h[0]}</span> · {h[2]}</div><div className="sub">{h[1]} · {h[3]}</div></div>
          <div className="acts">{i === 0 ? <span className="pill ok">live</span> : !p.isAdmin ? null : <button className="btn sm" type="button" onClick={() => roll(h[0])}>Roll back to this</button>}</div></div>))}</div></div>
  );
}
